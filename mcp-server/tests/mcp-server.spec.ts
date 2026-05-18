import { test, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = resolve(__dirname, "../dist/index.js");
const bundledSkills = JSON.parse(
  readFileSync(resolve(__dirname, "../src/skills.json"), "utf-8"),
) as Array<{ metadata: { domain: string } }>;

async function createClient(env?: Record<string, string>): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_SCRIPT],
    env: { ...process.env, ...env } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

test.describe("MCP Server — Startup", () => {
  let client: Client;

  test.afterEach(async () => {
    await client?.close();
  });

  test("registers one tool and prompt per bundled skill plus meta tools", async () => {
    client = await createClient();

    const { tools } = await client.listTools();
    const metaTools = ["list_skills", "get_skill_details", "find_skills", "suggest_skills"];
    expect(tools.length).toBe(bundledSkills.length + metaTools.length);
    for (const name of metaTools) {
      expect(tools.find((t) => t.name === name)).toBeTruthy();
    }

    const { prompts } = await client.listPrompts();
    expect(prompts.length).toBe(bundledSkills.length);
  });
});

test.describe("MCP Server — list_skills", () => {
  let client: Client;

  test.beforeEach(async () => {
    client = await createClient();
  });

  test.afterEach(async () => {
    await client?.close();
  });

  test("returns skills grouped by all bundled domains", async () => {
    const result = await client.callTool({ name: "list_skills", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;

    const expectedDomains = Array.from(
      new Set(bundledSkills.map((s) => s.metadata.domain)),
    );

    for (const domain of expectedDomains) {
      expect(text).toContain(`## ${domain}`);
    }
  });

  test("filters by single domain", async () => {
    const result = await client.callTool({
      name: "list_skills",
      arguments: { domain: "memory-learning-science" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;

    expect(text).toContain("## memory-learning-science");
    expect(text).not.toContain("## curriculum-assessment");
    expect(text).toContain("Cognitive Load Analyser");
  });
});

test.describe("MCP Server — suggest_skills", () => {
  let client: Client;

  test.beforeEach(async () => {
    client = await createClient();
  });

  test.afterEach(async () => {
    await client?.close();
  });

  test("returns 3-5 results for a plain English query", async () => {
    const result = await client.callTool({
      name: "suggest_skills",
      arguments: {
        problem_description:
          "My students struggle with reading comprehension and I need scaffolded tasks for EAL learners",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;

    const skillMatches = text.match(/- \*\*[^*]+\*\*/g);
    expect(skillMatches).toBeTruthy();
    expect(skillMatches!.length).toBeGreaterThanOrEqual(3);
    expect(skillMatches!.length).toBeLessThanOrEqual(5);
  });

  test("returns domain fallback when no matches found", async () => {
    const result = await client.callTool({
      name: "suggest_skills",
      arguments: {
        problem_description: "xyzzyplugh",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;

    expect(text).toContain("list_skills");
    expect(text).toContain("Available domains");
  });
});

test.describe("MCP Server — skill tools", () => {
  let client: Client;

  test.beforeEach(async () => {
    client = await createClient();
  });

  test.afterEach(async () => {
    await client?.close();
  });

  test("returns instruction-framed prompt with inputs substituted", async () => {
    const result = await client.callTool({
      name: "cognitive-load-analyser",
      arguments: {
        task_description:
          "Students read a passage about mitosis while labelling a diagram",
        student_level: "Year 9 novice",
      },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;

    expect(text).toContain("INSTRUCTIONS: You are now executing an education skill");
    expect(text).toContain("<skill_instructions>");
    expect(text).toContain("Generate the complete output now.");
    expect(text).toContain("Cognitive Load Theory");
    expect(text).toContain("mitosis");
    expect(text).toContain("Year 9 novice");
  });

  test("handles collision names with domain prefix", async () => {
    const { tools } = await client.listTools();
    const criticalThinkingTools = tools.filter((t) =>
      t.name.includes("critical-thinking-task-designer"),
    );

    expect(criticalThinkingTools.length).toBe(2);
    expect(criticalThinkingTools.map((t) => t.name).sort()).toEqual([
      "curriculum-assessment__critical-thinking-task-designer",
      "literacy-critical-thinking__critical-thinking-task-designer",
    ]);
  });
});

test.describe("MCP Server — skill prompts", () => {
  let client: Client;

  test.beforeEach(async () => {
    client = await createClient();
  });

  test.afterEach(async () => {
    await client?.close();
  });

  test("returns assembled prompt as user message with inputs substituted", async () => {
    const result = await client.getPrompt({
      name: "cognitive-load-analyser",
      arguments: {
        task_description:
          "Students read a passage about mitosis while labelling a diagram",
        student_level: "Year 9 novice",
      },
    });

    expect(result.messages.length).toBe(1);
    expect(result.messages[0].role).toBe("user");

    const text = result.messages[0].content as { type: string; text: string };
    expect(text.type).toBe("text");
    // Should contain the expert role framing from the prompt
    expect(text.text).toContain("Cognitive Load Theory");
    // Should contain the teacher input section with substituted values
    expect(text.text).toContain("## Teacher Input");
    expect(text.text).toContain("mitosis");
    expect(text.text).toContain("Year 9 novice");
  });

  test("handles collision names with domain prefix", async () => {
    const { prompts } = await client.listPrompts();
    const criticalThinking = prompts.filter((p) =>
      p.name.includes("critical-thinking-task-designer"),
    );

    expect(criticalThinking.length).toBe(2);
    expect(criticalThinking.map((p) => p.name).sort()).toEqual([
      "curriculum-assessment__critical-thinking-task-designer",
      "literacy-critical-thinking__critical-thinking-task-designer",
    ]);
  });
});

test.describe("MCP Server — SKILLS_FILTER", () => {
  let client: Client;

  test.afterEach(async () => {
    await client?.close();
  });

  test("limits loaded domains to those in SKILLS_FILTER", async () => {
    client = await createClient({
      SKILLS_FILTER: "memory-learning-science,explicit-instruction",
    });

    // Skill tools + 4 meta-tools, filtered
    const { tools } = await client.listTools();
    const metaTools = ["list_skills", "get_skill_details", "find_skills", "suggest_skills"];
    const skillTools = tools.filter((t) => !metaTools.includes(t.name));
    expect(skillTools.length).toBeGreaterThan(0);
    expect(skillTools.length).toBeLessThan(131);

    // Prompts should be filtered too
    const { prompts } = await client.listPrompts();
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts.length).toBeLessThan(131);

    // Verify via list_skills that only filtered domains appear
    const result = await client.callTool({ name: "list_skills", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;

    expect(text).toContain("## memory-learning-science");
    expect(text).toContain("## explicit-instruction");
    expect(text).not.toContain("## curriculum-assessment");
    expect(text).not.toContain("## wellbeing-motivation-agency");
  });
});
