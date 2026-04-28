const https = require("https");

module.exports = async function (context, req) {
    context.res = {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
    };

    if (req.method === "OPTIONS") {
        context.res.status = 200;
        context.res.body = {};
        return;
    }

    const userMessage = req.body?.message;
    if (!userMessage) {
        context.res.status = 400;
        context.res.body = { error: "No message provided" };
        return;
    }

    const TENANT_ID     = process.env.AZURE_TENANT_ID;
    const CLIENT_ID     = process.env.AZURE_CLIENT_ID;
    const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

    // Debug — show what variables are loaded
    context.log("TENANT_ID set:", !!TENANT_ID, TENANT_ID?.substring(0,8));
    context.log("CLIENT_ID set:", !!CLIENT_ID, CLIENT_ID?.substring(0,8));
    context.log("CLIENT_SECRET set:", !!CLIENT_SECRET);

    if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
        context.res.status = 500;
        context.res.body = {
            error: "Missing env vars",
            tenant: !!TENANT_ID,
            client: !!CLIENT_ID,
            secret: !!CLIENT_SECRET
        };
        return;
    }

    try {
        const tokenBody = `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${encodeURIComponent(CLIENT_SECRET)}&scope=https%3A%2F%2Fai.azure.com%2F.default`;

        const tokenData = await new Promise((resolve, reject) => {
            const options = {
                hostname: "login.microsoftonline.com",
                path: `/${TENANT_ID}/oauth2/v2.0/token`,
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Content-Length": Buffer.byteLength(tokenBody)
                }
            };
            const r = https.request(options, res => {
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => {
                    context.log("Token HTTP status:", res.statusCode);
                    context.log("Token response:", data.substring(0, 500));
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error("Parse: " + data)); }
                });
            });
            r.on("error", err => {
                context.log("Token request error:", err.message);
                reject(err);
            });
            r.write(tokenBody);
            r.end();
        });

        context.log("Token data keys:", Object.keys(tokenData).join(", "));

        if (!tokenData.access_token) {
            context.res.status = 500;
            context.res.body = {
                error: "No token received",
                detail: tokenData
            };
            return;
        }

        context.res.status = 200;
        context.res.body = { reply: "Token obtained successfully! Next: calling agent..." };

    } catch (err) {
        context.log("CATCH:", err.message);
        context.res.status = 500;
        context.res.body = { error: err.message };
    }
};
