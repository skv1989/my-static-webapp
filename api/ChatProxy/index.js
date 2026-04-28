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

        // Step 2: Create thread
        const thread = await callJson(token, "POST",
            `${BASE}/threads?api-version=${VER}`, {});
        context.log("Thread:", JSON.stringify(thread));

        if (!thread.id) {
            context.res.status = 500;
            context.res.body = { error: "Thread failed", detail: thread };
            return;
        }

        // Step 3: Add message
        const msg = await callJson(token, "POST",
            `${BASE}/threads/${thread.id}/messages?api-version=${VER}`, {
            role: "user",
            content: userMessage
        });
        context.log("Message:", JSON.stringify(msg));

        // Step 4: Create run with assistant_id
        const run = await callJson(token, "POST",
            `${BASE}/threads/${thread.id}/runs?api-version=${VER}`, {
            assistant_id: "ExlReader"
        });
        context.log("Run:", JSON.stringify(run));

        if (!run.id) {
            context.res.status = 500;
            context.res.body = { error: "Run failed", detail: run };
            return;
        }

        // Step 5: Poll
        let status = run.status;
        let tries = 0;
        while (!["completed","failed","cancelled"].includes(status) && tries < 30) {
            await sleep(2000);
            const poll = await callJson(token, "GET",
                `${BASE}/threads/${thread.id}/runs/${run.id}?api-version=${VER}`, null);
            status = poll.status;
            context.log("Poll:", status);
            tries++;
        }

        // Step 6: Get messages
        if (status === "completed") {
            const msgs = await callJson(token, "GET",
                `${BASE}/threads/${thread.id}/messages?api-version=${VER}`, null);
            const reply = msgs.data[0].content
                .filter(c => c.type === "text")
                .map(c => c.text.value)
                .join("");
            context.res.status = 200;
            context.res.body = { reply };
        } else {
            context.res.status = 500;
            context.res.body = { error: "Run status: " + status };
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
                catch (e) { reject(new Error("JSON parse error: " + data.substring(0, 200))); }
            });
        });
        req.on("error", reject);
        if (bodyStr) req.write(bodyStr);
        req.end();
    });
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
