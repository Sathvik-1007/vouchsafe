/**
 * @file The capability graph.
 *
 * Responsible for: drawing which capabilities this origin has borrowed, as
 * lines between two origin nodes, and animating a line in or out when a grant
 * changes.
 *
 * NOT responsible for: any state. It is a pure function of the tool list it is
 * handed, so a redraw can never disagree with the registry.
 *
 * Drawn as inline SVG rather than a chart library. There are two nodes and at
 * most thirteen edges, the layout is fixed, and a dependency would be larger
 * than the file that replaces it.
 */

/** Horizontal centre of the vault node. */
const VAULT_X = 175;

/** Horizontal centre of the host node. */
const HOST_X = 960;

/** Half-width of a node box. */
const NODE_W = 145;

/** Vertical centre of both nodes. */
const MID_Y = 150;

/** Half-height of a node box. */
const NODE_H = 34;

/**
 * Where a capability line ends and its label begins.
 *
 * The labels sit between the two nodes rather than beside the receiving one.
 * An earlier layout ran them into the host node's caption, because nine lanes
 * at 19px span 152px vertically and the caption sat inside that band. Putting
 * the column in the gap removes the collision by construction instead of
 * tuning offsets until it happens to look right.
 */
const LANE_END_X = 600;

/** Vertical space between adjacent capability lines. */
const LANE_GAP = 19;

/** Most lines drawn before they are collapsed into a count. */
const MAX_LANES = 11;

/** Total drawing height. Captions sit below the deepest possible lane. */
const VIEW_H = 300;

/** Escape text for SVG interpolation. */
function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Draw one origin node.
 *
 * @param {number} x centre
 * @param {string} title
 * @param {string} subtitle
 * @param {string} accent stroke colour
 * @returns {string} SVG markup
 */
function node(x, title, subtitle, accent) {
  const w = NODE_W * 2;
  return (
    '<g>' +
    '<rect x="' + (x - w / 2) + '" y="' + (MID_Y - NODE_H) + '" width="' + w + '" height="' + NODE_H * 2 + '" ' +
    'rx="9" fill="#12161b" stroke="' + accent + '" stroke-width="1.5"/>' +
    '<text x="' + x + '" y="' + (MID_Y - 6) + '" text-anchor="middle" fill="#e8edf3" ' +
    'font-family="ui-monospace, monospace" font-size="13">' + esc(title) + '</text>' +
    '<text x="' + x + '" y="' + (MID_Y + 14) + '" text-anchor="middle" fill="#63707f" ' +
    'font-family="ui-monospace, monospace" font-size="10.5">' + esc(subtitle) + '</text>' +
    '</g>'
  );
}

/**
 * Render the graph into an SVG element.
 *
 * @param {SVGElement} svg
 * @param {{vaultOrigin: string, hostOrigin: string,
 *          borrowed: Array<{name: string}>, vaultReachable: boolean}} state
 * @returns {void}
 */
export function drawGraph(svg, state) {
  const borrowed = state.borrowed ?? [];
  const shown = borrowed.slice(0, MAX_LANES);
  const overflow = borrowed.length - shown.length;

  const parts = [];

  // The boundary. Drawn first so everything else sits on top of it.
  parts.push(
    '<line x1="470" y1="12" x2="470" y2="252" stroke="#333d4a" stroke-width="1" ' +
      'stroke-dasharray="3 5"/>' +
      '<text x="470" y="266" text-anchor="middle" fill="#63707f" ' +
      'font-family="ui-monospace, monospace" font-size="9.5" letter-spacing="1.5">ORIGIN BOUNDARY</text>'
  );

  if (shown.length === 0) {
    parts.push(
      '<text x="470" y="' + (MID_Y + 4) + '" text-anchor="middle" fill="#63707f" ' +
        'font-family="ui-monospace, monospace" font-size="11.5">' +
        (state.vaultReachable
          ? 'no permissions granted — this site knows nothing'
          : 'vault not reachable') +
        '</text>'
    );
  }

  // One lane per borrowed capability, fanned symmetrically about the midline.
  const top = MID_Y - ((shown.length - 1) * LANE_GAP) / 2;
  shown.forEach((tool, i) => {
    const y = top + i * LANE_GAP;
    const label = String(tool.name ?? '');
    parts.push(
      // vault edge -> label dot, then label dot -> host edge, so every line is
      // visibly continuous through its own name.
      '<path d="M ' + (VAULT_X + NODE_W) + ' ' + MID_Y +
        ' C 400 ' + MID_Y + ', 470 ' + y + ', ' + LANE_END_X + ' ' + y + '" ' +
        'fill="none" stroke="#4ade80" stroke-width="1.2" opacity="0.75">' +
        '<animate attributeName="opacity" values="0;0.75" dur="260ms" fill="freeze"/>' +
        '</path>' +
        '<path d="M ' + (LANE_END_X + 132) + ' ' + y + ' L ' + (HOST_X - NODE_W) + ' ' + y + '" ' +
        'fill="none" stroke="#4ade80" stroke-width="1.2" opacity="0.45"/>' +
        '<circle cx="' + LANE_END_X + '" cy="' + y + '" r="2.4" fill="#4ade80"/>' +
        '<text x="' + (LANE_END_X + 8) + '" y="' + (y + 3.4) + '" fill="#9aa7b6" ' +
        'font-family="ui-monospace, monospace" font-size="9.5">' + esc(label) + '</text>'
    );
  });

  if (overflow > 0) {
    parts.push(
      '<text x="' + (LANE_END_X + 8) + '" y="' + (top + shown.length * LANE_GAP + 3) + '" ' +
        'fill="#63707f" font-family="ui-monospace, monospace" font-size="9.5">+' + overflow + ' more</text>'
    );
  }

  parts.push(node(VAULT_X, 'applicant vault', shortOrigin(state.vaultOrigin), '#4ade80'));
  parts.push(node(HOST_X, 'this letting agent', shortOrigin(state.hostOrigin), '#7dd3fc'));

  // Captions sit below every possible lane, so they can never be overrun no
  // matter how many capabilities are borrowed.
  const captionY = VIEW_H - 8;
  parts.push(
    '<text x="' + VAULT_X + '" y="' + captionY + '" text-anchor="middle" ' +
      'fill="#63707f" font-family="ui-monospace, monospace" font-size="9.5">' +
      'holds the facts, answers questions</text>' +
      '<text x="' + HOST_X + '" y="' + captionY + '" text-anchor="middle" ' +
      'fill="#63707f" font-family="ui-monospace, monospace" font-size="9.5">' +
      'holds nothing, asks questions</text>'
  );

  svg.innerHTML = parts.join('');
}

/**
 * Shorten an origin for display, keeping the part that identifies it.
 *
 * @param {string} origin
 * @returns {string}
 */
export function shortOrigin(origin) {
  return String(origin ?? '').replace(/^https?:\/\//, '');
}
