// aiService.js
"use strict";
require("dotenv").config();
const { WatsonXAI } = require("@ibm-cloud/watsonx-ai");
const { IamAuthenticator } = require("ibm-cloud-sdk-core");
const { getModelId, formatPrompt } = require("./ai/modelFamily");

// ---------------------------------------------------------
// LAZY CLIENT
// ---------------------------------------------------------
let _client = undefined; // undefined = not yet tried; null = no key
let _fallbackWarned = false;

function getClient() {
  if (_client !== undefined) return _client;
  const apikey = process.env.WATSONX_API_KEY;
  if (!apikey) {
    _client = null;
    return null;
  }
  try {
    _client = WatsonXAI.newInstance({
      version: "2024-05-31",
      serviceUrl: process.env.WATSONX_URL,
      authenticator: new IamAuthenticator({ apikey }),
    });
  } catch (e) {
    _client = null;
  }
  return _client;
}

const AI_ENABLED = () => getClient() !== null;

function warnFallback() {
  if (!_fallbackWarned) {
    _fallbackWarned = true;
    console.warn(
      "⚠️  watsonx not configured — using deterministic fallback text (set WATSONX_API_KEY to enable AI explanations)"
    );
  }
}

const PROJECT_ID = process.env.WATSONX_PROJECT_ID;

// ---------------------------------------------------------
// HYBRID PARSER: JSON.parse with Regex Fallback
// ---------------------------------------------------------
const SEVERITY_WHITELIST = ["Minor", "Major", "Critical"];

function parseExcursionResponse(text, temp) {
  // Strategy 1: Attempt standard JSON extraction
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    let jsonStr = text
      .substring(firstBrace, lastBrace + 1)
      .replace(/,\s*}/g, "}");
    try {
      const parsed = JSON.parse(jsonStr);
      const severity = parsed.severity || parsed.Severity;
      const action = parsed.recommendedAction || parsed.recommended_action;
      if (severity && action && SEVERITY_WHITELIST.includes(severity)) {
        return { severity, recommendedAction: action };
      }
      // severity present but not whitelisted — fall through
    } catch (e) {
      // Unescaped quotes inside JSON string values cause JSON.parse to fail.
      // Fall through to regex strategy below.
    }
  }

  // Strategy 2: Resilient Regex Extraction
  const severityMatch = text.match(/"?severity"?\s*:\s*"?([A-Za-z]+)"?/i);
  let severity = severityMatch ? severityMatch[1] : null;
  if (!SEVERITY_WHITELIST.includes(severity)) {
    severity = null; // invalid value from model — fall through to band fallback
  }

  // Extract recommended action
  const actionMatch =
    text.match(
      /"?(?:recommendedAction|recommended_action)"?\s*:\s*"([^"\r\n]+)"/i,
    ) ||
    text.match(
      /"?(?:recommendedAction|recommended_action)"?\s*:\s*"([\s\S]*?)(?:"\s*[,}]|\}\s*$)/i,
    );
  let action = actionMatch ? actionMatch[1].replace(/["\\]/g, "").trim() : null;

  // Strategy 3: Grounded Safety Fallbacks
  if (!severity) {
    if (temp > 13.0) severity = "Critical";
    else if (temp > 10.0) severity = "Major";
    else severity = "Minor";
  }

  if (!action || action.length < 5) {
    if (severity === "Critical") {
      action =
        "Halt delivery immediately. Cargo spoiled. File regulatory excursion report.";
    } else if (severity === "Major") {
      action =
        "Quarantine shipment at receiving dock for quality assurance viability testing.";
    } else {
      action = "Adjust refrigeration unit and monitor telemetry closely.";
    }
  }

  return { severity, recommendedAction: action };
}

function parseReroutingResponse(text, idleFleets) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    let jsonStr = text
      .substring(firstBrace, lastBrace + 1)
      .replace(/,\s*}/g, "}");
    try {
      return JSON.parse(jsonStr);
    } catch (e) {}
  }

  const actionMatch = text.match(/"?recommendedAction"?\s*:\s*"([^"\r\n]+)"/i);
  const routeMatch = text.match(/"?alternateRoute"?\s*:\s*"([^"\r\n]+)"/i);

  return {
    recommendedAction: actionMatch
      ? actionMatch[1]
      : "Divert affected shipments to secondary inland logistics hub.",
    reassignedAssets: idleFleets.slice(0, 2).map((f) => f.assetId),
    alternateRoute: routeMatch
      ? routeMatch[1]
      : "Reroute via interstate freight corridor to bypass disruption.",
  };
}

// ---------------------------------------------------------
// WATSONX API CALLS
// ---------------------------------------------------------
async function classifyExcursion(sensorLog) {
  const client = getClient();
  if (!client) {
    warnFallback();
    return parseExcursionResponse("", sensorLog.temperatureCelsius);
  }

  const prompt = formatPrompt(
    "You are a cold chain compliance assistant. Output raw JSON only. Do not use quotes inside sentence values.",
    `Shipment: ${sensorLog.shipmentId}
Temperature: ${sensorLog.temperatureCelsius}°C
Standard Range: 2.0°C to 8.0°C

Classify severity based on GDP guidelines:
- Minor: 8.1°C to 10.0°C
- Major: 10.1°C to 13.0°C
- Critical: >13.0°C

Output this schema exactly:
{
  "severity": "Minor or Major or Critical",
  "recommendedAction": "single sentence instruction without any nested quotes"
}`
  );

  try {
    const response = await client.generateText({
      modelId: getModelId(),
      projectId: PROJECT_ID,
      input: prompt,
      parameters: {
        max_new_tokens: 150,
        temperature: 0.0,
        decoding_method: "greedy",
      },
    });

    const rawText = response.result.results[0].generated_text;
    return parseExcursionResponse(rawText, sensorLog.temperatureCelsius);
  } catch (error) {
    console.error("watsonx API Network Error:", error.message);
    return parseExcursionResponse("", sensorLog.temperatureCelsius);
  }
}

async function generateReroutingStrategy(
  disruptionType,
  location,
  affectedShipments,
  idleFleets,
) {
  const client = getClient();
  if (!client) {
    warnFallback();
    return parseReroutingResponse("", idleFleets);
  }

  const prompt = formatPrompt(
    "You are a Supply Chain Disruption Assistant. Output raw JSON only.",
    `Disruption: ${disruptionType} at ${location}
Impacted Shipments: ${affectedShipments.length}
Available Idle Assets: ${idleFleets.map((f) => f.assetId).join(", ")}

Output this schema exactly:
{
  "recommendedAction": "single sentence without nested quotes",
  "reassignedAssets": ["assetId1", "assetId2"],
  "alternateRoute": "brief route description without nested quotes"
}`
  );

  try {
    const response = await client.generateText({
      modelId: getModelId(),
      projectId: PROJECT_ID,
      input: prompt,
      parameters: {
        max_new_tokens: 250,
        temperature: 0.0,
        decoding_method: "greedy",
      },
    });

    const rawText = response.result.results[0].generated_text;
    return parseReroutingResponse(rawText, idleFleets);
  } catch (error) {
    console.error("watsonx Rerouting API Error:", error.message);
    return parseReroutingResponse("", idleFleets);
  }
}

async function processChatQuery(message, contextData) {
  const client = getClient();
  if (!client) {
    warnFallback();
    // Grounded fallback response for demo purposes
    if (message.toLowerCase().includes("what shipments") || message.toLowerCase().includes("affected")) {
      return "Based on the live data, the following critical vaccine shipments are impacted by the active disruption: " + (contextData.shipments?.map(s => s.shipmentId).join(", ") || "None") + ". I recommend approving the pending rerouting actions in the Action Center.";
    } else if (message.toLowerCase().includes("why") || message.toLowerCase().includes("rationale")) {
      return "The recommendation prioritizes mitigating the disruption risk while ensuring cold-chain integrity. The suggested idle fleets are cold-chain capable and located near the rerouted hubs to minimize deadhead distance.";
    }
    return "I am the Supply Chain AI Copilot. The system is currently monitoring " + (contextData.shipments?.length || 0) + " active shipments and " + (contextData.disruptions?.length || 0) + " active disruptions. How can I assist you with operational triage?";
  }

  const prompt = formatPrompt(
    `You are the AI Operations Copilot for a Supply Chain Control Tower.
Use the following live system context to answer the user's operational question. Be concise and professional. Do not fabricate information.
System Context (JSON):
${JSON.stringify(contextData)}`,
    message
  );

  try {
    const response = await client.generateText({
      modelId: getModelId(),
      projectId: PROJECT_ID,
      input: prompt,
      parameters: {
        max_new_tokens: 300,
        temperature: 0.2,
      },
    });
    return response.result.results[0].generated_text;
  } catch (error) {
    console.error("watsonx Chat API Error:", error.message);
    // Grounded fallback response for demo purposes
    if (message.toLowerCase().includes("what shipments") || message.toLowerCase().includes("affected")) {
      return "Based on the live data, the following critical vaccine shipments are impacted by the active disruption: " + (contextData.shipments?.map(s => s.shipmentId).join(", ") || "None") + ". I recommend approving the pending rerouting actions in the Action Center.";
    } else if (message.toLowerCase().includes("why") || message.toLowerCase().includes("rationale")) {
      return "The recommendation prioritizes mitigating the disruption risk while ensuring cold-chain integrity. The suggested idle fleets are cold-chain capable and located near the rerouted hubs to minimize deadhead distance.";
    }
    return "I am the Supply Chain AI Copilot. The system is currently monitoring " + (contextData.shipments?.length || 0) + " active shipments and " + (contextData.disruptions?.length || 0) + " active disruptions. How can I assist you with operational triage?";
  }
}

module.exports = { classifyExcursion, generateReroutingStrategy, processChatQuery, AI_ENABLED };
