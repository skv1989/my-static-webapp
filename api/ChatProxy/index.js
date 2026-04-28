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
    const VECTOR_STORE  = "vs_ceSQP1x6kgLxsMeP8aOibW67";
    const MODEL         = "gpt-4.1";

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
        const thread = await callApi(token, "POST", `${BASE}/threads?api-version=${VER}`, {
            tool_resources: {
                file_search: { vector_store_ids: [VECTOR_STORE] }
            }
        });

        if (!thread.id) {
            context.res.status = 500;
            context.res.body = { error: "Thread failed", detail: thread };
            return;
        }

        const threadId = thread.id;
        context.log("Thread:", threadId);

        // Step 3: Add message
        await callApi(token, "POST", `${BASE}/threads/${threadId}/messages?api-version=${VER}`, {
            role: "user",
            content: userMessage
        });

        // Step 4: Run agent
        const run = await callApi(token, "POST", `${BASE}/threads/${threadId}/runs?api-version=${VER}`, {
            model: MODEL,
            instructions: "You are ExlReader, an AI agent that analyzes employee Excel data. Answer questions based on the uploaded file.",
            tools: [{ type: "file_search" }],
            tool_resources: {
                file_search: { vector_store_ids: [VECTOR_STORE] }
            }
        });

        if (!run.id) {
            context.res.status = 500;
            context.res.body = { error: "Run failed", detail: run };
            return;
        }

        context.log("Run:", run.id, "Status:", run.status);

        // Step 5: Poll until complete
        let status = run.status;
        let tries  = 0;
        while (status !== "completed" && status !== "failed" && status !== "cancelled" && tries < 30) {
            await sleep(2000);
            const poll = await callApi(token, "GET", `${BASE}/threads/${threadId}/runs/${run.id}?api-version=${VER}`, null);
            status = poll.status;
            context.log("Poll:", status);
            tries++;
        }

        // Step 6: Get reply
        if (status === "completed") {
            const msgs  = await callApi(token, "GET", `${BASE}/threads/${threadId}/messages?api-version=${VER}`, null);
            const reply = msgs.data[0].content
                .filter(c => c.type === "text")
                .map(c => c.text.value)
                .join("");
            context.res.status = 200;
            context.res.body   = { reply };
        } else {
            context.res.status = 500;
            context.res.body   = { error: "Run status: " + status };
        }

    } catch (err) {
        context.log("Error:", err.message);
        context.res.status = 500;
        context.res.body   = { error: err.message };
    }
};

function callApi(token, method, url, body) {
    return new Promise((resolve, reject) => {
        const parsed  = new URL(url);
        const bodyStr = body !== null ? JSON.stringify(body) : null;
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${token}`,
                ...(bodyStr && { "Content-Length": Buffer.byteLength(bodyStr) })
            }
        };
        const req = https.request(options, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("Parse: " + data)); }
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
