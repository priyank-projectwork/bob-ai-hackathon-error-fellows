// ai/modelFamily.js
"use strict";

const DEFAULT_MODEL = "meta-llama/llama-4-maverick-17b-128e-instruct-fp8";

function getModelId() {
  return process.env.MODEL_ID || DEFAULT_MODEL;
}

function formatPrompt(system, user) {
  const id = getModelId();
  if (id.includes("llama")) {
    return (
      `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n` +
      `${system}<|eot_id|><|start_header_id|>user<|end_header_id|>\n` +
      `${user}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n`
    );
  }
  if (id.includes("granite")) {
    return `<|system|>\n${system}\n<|user|>\n${user}\n<|assistant|>\n`;
  }
  return `${system}\n\n${user}`;
}

module.exports = { getModelId, formatPrompt };
