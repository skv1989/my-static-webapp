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

    try {
        // Step 1: Get token
        const tokenBody = `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${encodeURIComponent(CLIENT_SECRET)}&scope=https%3A%2F%2Fai.azure.com%2F.default`;

        const tokenData = await postForm("login.microsoftonline.com",
            `/${TENANT_ID}/oauth2/v2.0/token`, tokenBody);

        if (!tokenData.access_token) {
            context.res.status = 500;
            context.res.body = { error: "No token", detail: tokenData };
            return;
        }

        const token = tokenData.access_token;
        context.log("✅ Token obtained");

        // Step 2: Use Responses API with agent_reference
        const responseBody = {
            model: "gpt-4.1",
            input: [{ role: "user", content: userMessage }],
            agent_reference: {
                name: "ExlReader",
                version: "2",
                type: "agent_reference"
            }
        };

        const result = await callJson(token, "POST",
            `${BASE}/openai/v1/responses`, responseBody);

        context.log("Result:", JSON.stringify(result).substring(0, 500));

        if (result.output_text) {
            context.res.status = 200;
            context.res.body = { reply: result.output_text };
        } else if (result.output && result.output.length > 0) {
            const text = result.output
                .filter(o => o.type === "message")
                .flatMap(o => o.content || [])
                .filter(c => c.type === "output_text" || c.type === "text")
                .map(c => c.text || c.value || "")
                .join("");
            context.res.status = 200;
            context.res.body = { reply: text || JSON.stringify(result) };
        } else if (result.error) {
            context.res.status = 500;
            context.res.body = { error: result.error.message, detail: result };
        } else {
            context.res.status = 200;
            context.res.body = { reply: JSON.stringify(result) };
        }

    } catch (err) {
        context.log("ERROR:", err.message);
        context.res.status = 500;
        context.res.body = { error: err.message };
    }
};

function postForm(hostname, path, body) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname, path, method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": Buffer.byteLength(body)
            }
        };
        const req = https.request(options, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("Form parse: " + data)); }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

function callJson(token, method, url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const bodyStr = body !== null ? JSON.stringify(body) : null;
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
        };
        if (bodyStr) headers["Content-Length"] = Buffer.byteLength(bodyStr);

        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method, headers
        };
        const req = https.request(options, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                if (!data || data.trim() === "") {
                    resolve({ _empty: true, _status: res.statusCode });
                    return;
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("JSON parse: " + data.substring(0, 200))); }
            });
        });
        req.on("error", reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}
