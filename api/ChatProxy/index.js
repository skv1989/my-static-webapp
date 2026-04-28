const https = require("https");

module.exports = async function (context, req) {
    context.res = {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
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
    const BASE          = "https://readexcel-resource.services.ai.azure.com/api/projects/readexcel";
    const VER           = "2025-05-01";

    try {
        // Step 1: Get Azure AD token
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
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error("Token parse: " + data)); }
                });
            });
            r.on("error", reject);
            r.write(tokenBody);
            r.end();
        });

        if (!tokenData.access_token) {
            context.res.status = 500;
            context.res.body = { error: "No token", detail: tokenData };
            return;
        }

        const token = tokenData.access_token;
        context.log("Token obtained!");

        // Step 2: Create thread
        const thread = await callApi(token, "POST",
            `${BASE}/threads?api-version=${VER}`, {});

        context.log("Thr
