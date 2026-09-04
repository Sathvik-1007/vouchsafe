# Video script

**Target: 2 min 40 s.** Judges are not obliged to watch past three minutes, so
the strongest thing happens at 0:25, not at the end.

Record at **1920x1080**, browser at ~90% zoom so the capability graph and the
vault panel are both readable. Close other tabs. Hide bookmarks bar.

## Setup before you hit record

1. Open `https://bureau-lettings.vercel.app` in Brave or Chrome 149+ with WebMCP
   enabled (`chrome://flags/#enable-webmcp-testing`, or the launch flag
   `--enable-features=WebMCP`).
2. In the vault panel on the right, tick **"Let the guided demo drive these
   switches"**.
3. Scroll so the capability graph and the vault panel are both on screen.
4. Do **not** press play yet.

---

## 0:00 - 0:18  The problem

> "To rent a flat in Britain you upload your payslips, your bank statements and
> your passport. To six different letting agents. Who keep them, forever."

*(on screen: the live site, graph empty, "nothing borrowed")*

> "But none of them wanted your salary. They wanted one bit of information. Is
> your income at least three times the rent. Yes, or no."

## 0:18 - 0:30  The setup

> "This is Bureau. Two separate origins. On the left, a letting agent. On the
> right, in that frame, your own vault, on your own domain, holding your facts
> in your own browser."

*(cursor traces the origin boundary in the capability graph)*

> "The letting agent cannot read inside that frame. It can only ask."

## 0:30 - 1:05  The grant, and the money shot

*(press **Play the guided demo**)*

> "I grant nine permissions. Watch the graph."

*(nine green lines appear across the boundary)*

> "Those nine lines are live WebMCP registrations. The letting agent just
> borrowed nine capabilities from an origin it does not control, using
> `exposedTo` on one side and `getTools` with `fromOrigins` on the other. No API
> key. No partnership. No server between them."

> "Now it runs the checks. Nine cross-origin calls. Nine yes-or-no answers."

*(assessment fills in: eligible)*

> "Eligible. And it still holds nothing."

## 1:05 - 1:30  What was not handed over

*(point at the vault's comparison panel)*

> "Nine bits given. A hundred and twenty-two bits avoided. Thirty-seven facts
> about me that nobody asked for and nobody got: my tax code, my National
> Insurance number, every transaction on my bank statement, my nationality."

## 1:30 - 2:05  The attack

> "Here is the honest weakness. A yes-or-no answer leaks one bit, but the caller
> picks the threshold. So it can ask again."

*(the probe sequence runs, thresholds walking down)*

> "Two thousand, no. Fifteen hundred, no. Thirteen hundred, no. It is
> binary-searching my salary, and every single one of those answers was
> legitimate."

*(the refusal appears)*

> "The vault caught it. Five thresholds, then it stops, and it tells me who was
> doing it and how much they worked out."

## 2:05 - 2:30  Revocation

> "And if I change my mind."

*(the revoke step runs; a green line vanishes from the graph)*

> "That capability is gone from their hands. Not marked deleted. Gone. Fifteen
> tools, now fourteen. The check cannot run any more."

*(assessment re-runs: NOT GRANTED, incomplete)*

> "No server was asked to cooperate. The vault aborted a registration, the
> browser fired an event, and the tool disappeared mid-conversation."

## 2:30 - 2:40  Close

> "The letting agent gets an answer, not your life. That is what WebMCP makes
> possible, and it is the first time the web has been able to do it."

*(hold on the live URL)*

---

## Things to get right

- Say "one bit" out loud early. It is the whole idea.
- The graph losing a line is the single best frame in the video. Do not rush it.
- Do not read the tool names aloud. They are on screen.
- If a beat runs long, cut the comparison panel section, not the revocation.
