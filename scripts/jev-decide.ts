#!/usr/bin/env node
// CLI cho agent: hoi Jev buoc tiep theo truocc khi hao nang luong.
// Agent goi lenh nay DUOC, xem AGENTS.md.
//
// Dung:
//   echo '{"task":"...","failed_attempts":[],"candidate_routes":["a","b"],"reversible":"yes","consequential":"no"}' \
//     | npm run jev:decide
//   npm run jev:decide -- --live        # ap dung that (mac dinh: shadow, chi de so sanh)
//   npm run jev:decide -- --json '<json>'
//   npm run jev:live   -- --json '<json>'
//
// Exit code: 0 = OK, 2 = input sai, 3 = loi noi bo.
// KHONG bao gio in API key. KHONG log PII.

import { askAgentNextAction, formatAgentReceipt, type AgentDecisionState } from "../lib/ai/jev-agent-decide";

const args = process.argv.slice(2);
// Mac dinh SHADOW: tinh quyet dinh de so sanh, khong tu dong ap dung.
// Muon ap dung that: --live, hoac JEV_AGENT_LIVE=1.
const live = args.includes("--live") || process.env.JEV_AGENT_LIVE === "1";
const wantJson = args.includes("--json");
const stateFlag = args.indexOf("--state");

async function readState(): Promise<unknown> {
  const inline = args.find((a) => a.startsWith("--json="));
  if (inline) return JSON.parse(inline.slice("--json=".length));
  const inlineNext = args[args.indexOf("--json") + 1];
  if (args.includes("--json") && inlineNext && !inlineNext.startsWith("--")) return JSON.parse(inlineNext);
  if (stateFlag >= 0 && args[stateFlag + 1]) {
    const fs = await import("node:fs");
    return JSON.parse(fs.readFileSync(args[stateFlag + 1], "utf8"));
  }
  // Doc stdin
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

async function main() {
  let parsed: unknown;
  try {
    parsed = await readState();
  } catch (e) {
    console.error(`jev-decide: input JSON khong hop le — ${(e as Error).message}`);
    process.exit(2);
  }
  if (!parsed) {
    console.error(
      "jev-decide: thieu state. Vi du:\n" +
        '  echo \'{"task":"tim loi trong test fail","failed_attempts":["da doc file 3 lan"],"candidate_routes":["dung MCP graph","dung grep"],"reversible":"yes","consequential":"no"}\' | npm run jev:decide',
    );
    process.exit(2);
  }

  const receipt = await askAgentNextAction(parsed as AgentDecisionState, {
    mode: live ? "live" : "shadow",
  });

  if (wantJson) {
    console.log(JSON.stringify(receipt, null, 2));
  } else {
    console.log(formatAgentReceipt(receipt));
    console.log("");
    if (receipt.act) {
      console.log(`=> HANH DONG: ${receipt.action}`);
    } else {
      console.log("=> DUNG LAI: phai hoi nguoi dung xac nhan truoc kdi di tiep.");
    }
    if (receipt.mode !== "live") {
      console.log(`   (che do ${receipt.mode} — ket qua chi de tham khao, chua ap dung.)`);
    }
  }
}

main().catch((e) => {
  console.error(`jev-decide: loi noi bo — ${(e as Error).message}`);
  process.exit(3);
});
