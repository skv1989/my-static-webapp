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

    const API_KEY      = process.env.AZURE_AI_KEY;
    const VECTOR_STORE = "vs_ceSQP1x6kgLxsMeP8aOibW67";

    try {
        const requestBody = JSON.stringify({
            model: "gpt-4.1",
            messages: [
                {
                    role: "system",
                    content: `You are ExlReader, an intelligent AI agent that analyzes employee data.
You have access to an employee Excel file with these columns:
Serial Number, Name, Enterprise ID, Employee ID/SAP ID, Tower, Level, Mobile, Location, Skills.
The file has been indexed and you should answer questions about the employee data accurately.
If asked about specific counts, names, towers, levels or skills — answer based on the data available.
There are 9 employees in the dataset.`
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],
            max_tokens: 1000
        });

        const url = "https://readexcel-resource.openai.azure.com/openai/deployments/gpt-4.1/chat/completions?api-version=2024-12-01-preview";

        const reply = await callApi(API_KEY, url, requestBody);

        context.log("Response:", JSON.stringify(reply).substring(0, 200));

        if (reply.choices && reply.choices.length > 0) {
            context.res.status = 200;
            context.res.body = { reply: reply.choices[0].message.content };
        } else if (reply.error) {
            context.res.status = 500;
            context.res.body = { error: reply.error.message };
        } else {
            context.res.status = 500;
            context.res.body = { error: "Unexpected response", raw: reply };
        }

    } catch (err) {
        context.res.status = 500;
        context.res.body = { error: err.message };
    }
};

function callApi(apiKey, url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: "POST",
            headers: {
                "api-key": apiKey,
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body)
            }
        };
        const req = https.request(options, res => {
            let data = "";
            res.on("data", chunk => data += chunk);
            res.on("end", () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error("Parse error: " + data)); }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}
