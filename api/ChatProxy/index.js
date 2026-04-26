const https = require("https");
const http  = require("http");

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

    const BASE         = "https://readexcel-resource.services.ai.azure.com/api/projects/readexcel";
    const VER          = "2025-05-01";
    const VECTOR_STORE = "vs_ceSQP1x6kgLxsMeP8aOibW67";
    const MODEL        = "gpt-4.1";

    try {
        const endpoint = process.env.IDENTITY_ENDPOINT;
        const header   = process.env.IDENTITY_HEADER;

        if (!endpoint) {
            context.res.status = 500;
            context.res.body = { error: "Identity endpoint not configured" };
            return;
        }

        const tokenUrl  = `${endpoint}?api-version=2019-08-01&resource=https%3A%2F%2Fai.azure.com`;
        const parsedUrl = new URL(tokenUrl);
        const isHttps   = parsedUrl.protocol === "https:";
        const lib       = isHttps ? https : http;

        const tokenData = await new Promise((resolve, reject) => {
            const options = {
                hostname: parsedUrl.hostname,
                port: isHttps ? 443 : 80,
                path: parsedUrl.pathname + parsedUrl.search,
                method: "GET",
                headers: {
                    "X-IDENTITY-HEADER": header,
                    "Metadata": "true"
                }
            };
            const r = lib.request(options, res => {
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error("Token parse: " + data)); }
                });
            });
            r.on("error", reject);
            r.end();
        });

        if (!tokenData.access_token) {
            context.res.status = 500;
            context.res.body = { error: "No token", detail: tokenData };
            return;
        }

        const token = tokenData.access_token;

        // Step 1: Create thread
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

        // Step 2: Add message
        await callApi(token, "POST", `${BASE}/threads/${threadId}/messages?api-version=${VER}`, {
            role: "user",
            content: userMessage
        });

        // Step 3: Run
        const run = await callApi(token, "POST", `${BASE}/threads/${threadId}/runs?api-version=${VER}`, {
            model: MODEL,
            instructions: "You are ExlReader, an AI agent that analyzes employee Excel data. Answer questions based on the file.",
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

        // Step 4: Poll
        let status = run.status;
        let tries  = 0;
        while (status !== "completed" && status !== "failed" && status !== "cancelled" && tries < 30) {
            await sleep(2000);
            const poll = await callApi(token, "GET", `${BASE}/threads/${threadId}/runs/${run.id}?api-version=${VER}`, null);
            status = poll.status;
            tries++;
        }

        // Step 5: Get reply
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
