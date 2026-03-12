const satori = require("satori").default;
const { Resvg } = require("@resvg/resvg-js");
const fs = require("fs");
const path = require("path");

const FONT_DIR = path.join(__dirname, "..", "node_modules", "@fontsource", "inter", "files");

function loadFont(name) {
  return fs.readFileSync(path.join(FONT_DIR, name));
}

// -- Fluent UI Dark Theme tokens (from editor.css) --
const theme = {
  bg: "#1e1e1e",
  bgLighter: "#252526",
  bgLightest: "#2d2d2d",
  bgSurface: "#292929",
  border: "#3e3e42",
  borderSubtle: "#333336",
  text: "#d4d4d4",
  textMuted: "#808080",
  textSecondary: "#ababab",
  accent: "#0078d4",
  success: "#4ec96b",
  stringColor: "#ce9178",
  numberColor: "#b5cea8",
  booleanColor: "#569cd6",
  keyColor: "#9cdcfe",
  bracketColor: "#ffd700",
};

const WIDTH = 1280;
const HEIGHT = 720;

// Sample JSON lines that represent a Power Automate flow definition
const jsonLines = [
  { indent: 0, tokens: [{ text: "{", color: theme.bracketColor }] },
  {
    indent: 1,
    tokens: [
      { text: '"name"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"Send Approval Email Flow"', color: theme.stringColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 1,
    tokens: [
      { text: '"id"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"5a5e8de4-3a72-4c91-b2f1-abc123def456"', color: theme.stringColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 1,
    tokens: [
      { text: '"type"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"Microsoft.Flow/flows"', color: theme.stringColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 1,
    tokens: [
      { text: '"properties"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "{", color: theme.bracketColor },
    ],
  },
  {
    indent: 2,
    tokens: [
      { text: '"displayName"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"Send Approval Email Flow"', color: theme.stringColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 2,
    tokens: [
      { text: '"state"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"Started"', color: theme.stringColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 2,
    tokens: [
      { text: '"definition"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "{", color: theme.bracketColor },
    ],
  },
  {
    indent: 3,
    tokens: [
      { text: '"$schema"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"https://schema.management.azure.com/..."', color: theme.stringColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 3,
    tokens: [
      { text: '"contentVersion"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"1.0.0.0"', color: theme.stringColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 3,
    tokens: [
      { text: '"triggers"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "{", color: theme.bracketColor },
    ],
  },
  {
    indent: 4,
    tokens: [
      { text: '"When_a_new_email_arrives"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "{", color: theme.bracketColor },
    ],
  },
  {
    indent: 5,
    tokens: [
      { text: '"type"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"ApiConnectionNotification"', color: theme.stringColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 5,
    tokens: [
      { text: '"inputs"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "{", color: theme.bracketColor },
    ],
  },
  {
    indent: 6,
    tokens: [
      { text: '"host"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "{", color: theme.bracketColor },
    ],
  },
  {
    indent: 7,
    tokens: [
      { text: '"connection"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "{", color: theme.bracketColor },
    ],
  },
  {
    indent: 8,
    tokens: [
      { text: '"name"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: '"shared_office365"', color: theme.stringColor },
    ],
  },
  {
    indent: 7,
    tokens: [{ text: "}", color: theme.bracketColor }],
  },
  {
    indent: 6,
    tokens: [
      { text: "}", color: theme.bracketColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 6,
    tokens: [
      { text: '"fetchOnlyWithAttachment"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "true", color: theme.booleanColor },
      { text: ",", color: theme.text },
    ],
  },
  {
    indent: 6,
    tokens: [
      { text: '"includeAttachments"', color: theme.keyColor },
      { text: ": ", color: theme.text },
      { text: "false", color: theme.booleanColor },
    ],
  },
];

function buildLineElements() {
  return jsonLines.map((line, idx) => ({
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        height: 24,
        paddingLeft: 12 + line.indent * 18,
      },
      children: [
        // Line number
        {
          type: "span",
          props: {
            style: {
              color: "#5a5a5a",
              width: 40,
              textAlign: "right",
              marginRight: 16,
              fontSize: 13,
              fontFamily: "Inter",
              flexShrink: 0,
            },
            children: String(idx + 1),
          },
        },
        // Tokens
        ...line.tokens.map((token) => ({
          type: "span",
          props: {
            style: {
              color: token.color,
              fontSize: 13,
              fontFamily: "Inter",
            },
            children: token.text,
          },
        })),
      ],
    },
  }));
}

function buildTab(label, active) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        alignItems: "center",
        padding: "8px 16px",
        color: active ? theme.text : theme.textMuted,
        fontSize: 13,
        fontFamily: "Inter",
        fontWeight: active ? 600 : 400,
        borderBottom: active ? `2px solid ${theme.accent}` : "2px solid transparent",
      },
      children: label,
    },
  };
}

function buildToolbarButton(label, isPrimary) {
  return {
    type: "div",
    props: {
      style: {
        display: "flex",
        alignItems: "center",
        padding: "5px 10px",
        borderRadius: 4,
        fontSize: 12,
        fontFamily: "Inter",
        color: isPrimary ? "#ffffff" : theme.textSecondary,
        background: isPrimary ? theme.accent : "transparent",
        fontWeight: isPrimary ? 600 : 400,
      },
      children: label,
    },
  };
}

function buildSeparator() {
  return {
    type: "div",
    props: {
      style: {
        width: 1,
        height: 20,
        background: theme.border,
        margin: "0 4px",
      },
    },
  };
}

async function generatePreview() {
  const fontRegular = loadFont("inter-latin-400-normal.woff");
  const fontBold = loadFont("inter-latin-700-normal.woff");
  const fontSemiBold = loadFont("inter-latin-600-normal.woff");

  const markup = {
    type: "div",
    props: {
      style: {
        display: "flex",
        flexDirection: "column",
        width: WIDTH,
        height: HEIGHT,
        background: theme.bg,
        fontFamily: "Inter",
      },
      children: [
        // ===== TOOLBAR =====
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              height: 44,
              padding: "0 16px",
              background: theme.bgSurface,
              borderBottom: `1px solid ${theme.borderSubtle}`,
            },
            children: [
              // Left: Logo + Flow name + Badge
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                  },
                  children: [
                    {
                      type: "span",
                      props: {
                        style: {
                          fontWeight: 700,
                          fontSize: 14,
                          color: theme.accent,
                          fontFamily: "Inter",
                        },
                        children: "{ } AutomateFlow",
                      },
                    },
                    {
                      type: "span",
                      props: {
                        style: {
                          fontSize: 13,
                          color: theme.text,
                          fontFamily: "Inter",
                        },
                        children: "Send Approval Email Flow",
                      },
                    },
                    {
                      type: "span",
                      props: {
                        style: {
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 10,
                          fontWeight: 600,
                          background: "#0e3a1e",
                          color: theme.success,
                          fontFamily: "Inter",
                          textTransform: "uppercase",
                        },
                        children: "STARTED",
                      },
                    },
                  ],
                },
              },
              // Center: Tabs
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flex: 1,
                    justifyContent: "center",
                    gap: 0,
                  },
                  children: [
                    buildTab("Editor", true),
                    buildTab("Arvore", false),
                    buildTab("Acoes", false),
                    buildTab("Diff", false),
                    buildTab("Visualizar", false),
                    buildTab("Conexoes", false),
                  ],
                },
              },
              // Right: Buttons
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  },
                  children: [
                    buildToolbarButton("Formatar", false),
                    buildToolbarButton("Minificar", false),
                    buildToolbarButton("Validar", false),
                    buildSeparator(),
                    buildToolbarButton("Importar", false),
                    buildToolbarButton("Exportar", false),
                    buildToolbarButton("Copiar", false),
                    buildSeparator(),
                    buildToolbarButton("Salvar", true),
                  ],
                },
              },
            ],
          },
        },
        // ===== EDITOR AREA =====
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flex: 1,
              overflow: "hidden",
              flexDirection: "row",
            },
            children: [
              // Editor content
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
                    background: theme.bg,
                    padding: "8px 0",
                  },
                  children: buildLineElements(),
                },
              },
              // Minimap (right side)
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    width: 60,
                    background: theme.bgLighter,
                    borderLeft: `1px solid ${theme.borderSubtle}`,
                    padding: "8px 8px",
                    gap: 2,
                  },
                  children: jsonLines.map((line) => ({
                    type: "div",
                    props: {
                      style: {
                        display: "flex",
                        height: 3,
                        marginLeft: line.indent * 3,
                        width: 20 + Math.random() * 20,
                        background: "rgba(212, 212, 212, 0.15)",
                        borderRadius: 1,
                      },
                    },
                  })),
                },
              },
            ],
          },
        },
        // ===== STATUS BAR =====
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              height: 26,
              padding: "0 16px",
              background: theme.accent,
              color: "#ffffff",
              fontSize: 11,
              gap: 20,
              fontFamily: "Inter",
            },
            children: [
              {
                type: "span",
                props: {
                  style: { flex: 1, fontFamily: "Inter" },
                  children: "Pronto",
                },
              },
              {
                type: "span",
                props: {
                  style: { fontFamily: "Inter" },
                  children: "Ln 1, Col 1",
                },
              },
              {
                type: "span",
                props: {
                  style: { fontFamily: "Inter" },
                  children: "42.3 KB",
                },
              },
              {
                type: "span",
                props: {
                  style: { color: "#b5f5c8", fontFamily: "Inter" },
                  children: "JSON valido",
                },
              },
            ],
          },
        },
      ],
    },
  };

  const svg = await satori(markup, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      {
        name: "Inter",
        data: fontRegular,
        weight: 400,
        style: "normal",
      },
      {
        name: "Inter",
        data: fontSemiBold,
        weight: 600,
        style: "normal",
      },
      {
        name: "Inter",
        data: fontBold,
        weight: 700,
        style: "normal",
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  const outputPath = path.join(__dirname, "..", "assets", "preview.png");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, pngBuffer);

  console.log(`Preview image generated: ${outputPath} (${pngBuffer.length} bytes)`);
}

generatePreview().catch((err) => {
  console.error("Error generating preview:", err);
  process.exit(1);
});
