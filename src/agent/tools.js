// Tool schemas and system prompt for the Tessera AI agent. The agent runs
// client-side and drives the existing deterministic engine through these tools;
// it never does geometry itself. Keep descriptions prescriptive about WHEN to
// call each tool (this measurably improves tool selection).

export const AGENT_MODEL = 'claude-opus-4-8';

export const SYSTEM_PROMPT = `You are the assistant inside Tessera, a browser tool that splits 3D models into printable parts joined with connectors.

You help the user by driving the app's controls through tools. You never compute geometry yourself: you set parameters and call split, then report what happened.

Workflow:
1. Call get_state first to see the loaded model, printer volume, connector settings, and whether the mesh is a valid solid.
2. If the user describes an intent (e.g. "make it printable on my Ender 3", "join with magnets", "cut it in half along X"), translate it into tool calls.
3. Prefer the automatic grid unless the user asks for specific cuts; use set_manual_planes for explicit cuts.
4. Call split when the plan and connectors are set, then report the part count and whether the parts fit the printer.

Be concise. If no model is loaded, ask the user to load one. If the mesh is not a valid solid, mention repair. Confirm before doing anything the user did not ask for.`;

export const TOOLS = [
  {
    name: 'get_state',
    description:
      'Read the current app state: whether a model is loaded, its size in mm, the printer volume, the plan mode and cut planes, the connector settings, the estimated part count, whether parts fit the printer, and the mesh validity. Call this first, before other tools.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_printer',
    description:
      'Set the printer build volume in millimetres. Call when the user names a printer or gives dimensions.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X build size (mm)' },
        y: { type: 'number', description: 'Y build size (mm)' },
        z: { type: 'number', description: 'Z build size (mm)' },
      },
      required: ['x', 'y', 'z'],
      additionalProperties: false,
    },
  },
  {
    name: 'use_auto_grid',
    description:
      'Switch to the automatic grid partition, which computes the minimum axis-aligned cuts so every part fits the printer. Use this unless the user wants specific manual cuts.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_manual_planes',
    description:
      'Switch to manual mode and replace the cut planes with the given axis-aligned planes. Each plane is an axis (x, y, or z) and an offset in mm within the model bounds. Use for explicit cuts like "cut in half along X".',
    input_schema: {
      type: 'object',
      properties: {
        planes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              axis: { type: 'string', enum: ['x', 'y', 'z'] },
              offset: { type: 'number', description: 'position along the axis (mm)' },
            },
            required: ['axis', 'offset'],
            additionalProperties: false,
          },
        },
      },
      required: ['planes'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_connector',
    description:
      'Set the connector type and its parameters. Type "none" leaves parts unjoined; "pin" adds alignment pins; "insert" adds heat-set threaded inserts with screws; "magnet" adds magnet pockets; "dovetail" adds a sliding dovetail joint that locks against pull-apart. Only include the numeric fields relevant to the chosen type.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['none', 'pin', 'insert', 'magnet', 'dovetail'] },
        clearance: { type: 'number', description: 'fit clearance (mm)' },
        pinDiameter: { type: 'number' },
        pinLength: { type: 'number' },
        insertDiameter: { type: 'number' },
        insertDepth: { type: 'number' },
        screwDiameter: { type: 'number' },
        magnetDiameter: { type: 'number' },
        magnetThickness: { type: 'number' },
        dovetailWidth: { type: 'number', description: 'wide end of the dovetail (mm)' },
        dovetailNeck: { type: 'number', description: 'narrow end of the dovetail (mm)' },
        dovetailDepth: { type: 'number', description: 'how far the dovetail crosses the seam (mm)' },
        minWall: { type: 'number', description: 'minimum wall kept around a connector (mm)' },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_repair',
    description:
      'Enable or disable best-effort mesh repair (weld vertices, fill holes) applied before cutting. Enable it when the mesh is not a valid solid.',
    input_schema: {
      type: 'object',
      properties: { enabled: { type: 'boolean' } },
      required: ['enabled'],
      additionalProperties: false,
    },
  },
  {
    name: 'split',
    description:
      'Cut the loaded model with the current plan and connectors and show the exploded result. Returns the number of parts produced and whether they fit the printer. Call this once the plan and connectors are set.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

// Proactive mode: the agent may only read state and propose a plan for the user
// to approve. It cannot change settings or split. propose_plan records a
// suggestion that the UI renders with Apply / Dismiss buttons.
export const PROPOSE_TOOL = {
  name: 'propose_plan',
  description:
    'Propose a split plan for the user to approve. This does NOT change anything or cut the model. Call it once, after get_state, with your suggestion. Only include fields you want to change.',
  input_schema: {
    type: 'object',
    properties: {
      rationale: { type: 'string', description: 'one or two sentences explaining the suggestion' },
      planMode: { type: 'string', enum: ['auto', 'manual'] },
      printer: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        required: ['x', 'y', 'z'],
        additionalProperties: false,
      },
      planes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { axis: { type: 'string', enum: ['x', 'y', 'z'] }, offset: { type: 'number' } },
          required: ['axis', 'offset'],
          additionalProperties: false,
        },
      },
      connectorType: { type: 'string', enum: ['none', 'pin', 'insert', 'magnet', 'dovetail'] },
    },
    required: ['rationale', 'planMode'],
    additionalProperties: false,
  },
};

export const PROACTIVE_TOOLS = [TOOLS[0], PROPOSE_TOOL]; // get_state + propose_plan

export const PROACTIVE_SYSTEM = `${SYSTEM_PROMPT}

You are in PROACTIVE mode. Do NOT change any setting and do NOT split. Call get_state to inspect the model, then call propose_plan exactly once with a suggestion for the user to approve. If the model already fits the printer and needs no cuts, still call propose_plan with planMode "auto" and a rationale saying it already fits. Keep the rationale to one or two short sentences.`;

export const PROACTIVE_TRIGGER =
  'A model was just loaded. Inspect it and propose a split plan (or note that it already fits).';
