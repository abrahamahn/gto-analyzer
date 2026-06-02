import { describe, expect, it } from "vitest";
import { evaluateChart, evaluateHand, findChart, getChartById } from "./charts.js";
import { DEFAULT_CHARTS, loadDefaultCharts } from "./charts/data.js";
import { comboCount } from "./handClass.js";

loadDefaultCharts();

function requireChart(chartId: string) {
  const chart = getChartById(chartId);
  if (!chart) throw new Error(`missing chart: ${chartId}`);
  return chart;
}

function openingPercent(chartId: string): number {
  const chart = requireChart(chartId);
  const grid = evaluateChart(chart);
  let combos = 0;
  for (const [cls, mix] of Object.entries(grid)) {
    const aggressive = mix
      .filter((m) => m.type === "raise" || m.type === "all-in")
      .reduce((s, m) => s + m.frequency, 0);
    combos += comboCount(cls) * aggressive;
  }
  return combos / 1326;
}

describe("default charts", () => {
  it("loads every shipped chart with a unique id", () => {
    const ids = DEFAULT_CHARTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DEFAULT_CHARTS) expect(getChartById(c.id)).toBeDefined();
  });

  it("opens tighter from early position than the button (cash 100bb)", () => {
    const utg = openingPercent("cash-100bb-RFI-UTG");
    const co = openingPercent("cash-100bb-RFI-CO");
    const btn = openingPercent("cash-100bb-RFI-BTN");
    expect(utg).toBeLessThan(co);
    expect(co).toBeLessThan(btn);
  });

  it("keeps each cash RFI range in a sane band", () => {
    expect(openingPercent("cash-100bb-RFI-UTG")).toBeGreaterThan(0.1);
    expect(openingPercent("cash-100bb-RFI-UTG")).toBeLessThan(0.22);
    expect(openingPercent("cash-100bb-RFI-BTN")).toBeGreaterThan(0.38);
    expect(openingPercent("cash-100bb-RFI-BTN")).toBeLessThan(0.6);
  });

  it("ships tournament RFI charts for the common 6-max opening seats", () => {
    for (const stackBB of [40, 20]) {
      for (const position of ["UTG", "HJ", "CO", "BTN", "SB"] as const) {
        expect(findChart({ format: "mtt", stackBB, position, scenario: "RFI" })).toBeDefined();
      }
    }
  });

  it("keeps tournament openings wider in late position than early position", () => {
    for (const stackBB of [40, 20]) {
      expect(openingPercent(`mtt-${stackBB}bb-RFI-UTG`)).toBeLessThan(
        openingPercent(`mtt-${stackBB}bb-RFI-BTN`),
      );
      expect(openingPercent(`mtt-${stackBB}bb-RFI-BTN`)).toBeLessThan(
        openingPercent(`mtt-${stackBB}bb-RFI-SB`),
      );
    }
  });

  it("shoves wider than it opens — push/fold is the widest aggression", () => {
    expect(openingPercent("mtt-10bb-push-SB")).toBeGreaterThan(0.5);
  });
});

describe("evaluateHand", () => {
  it("always sums frequencies to 1 (fold is the remainder)", () => {
    const chart = requireChart("cash-100bb-RFI-BTN");
    for (const cls of ["AA", "72o", "76s", "K7o"]) {
      const total = evaluateHand(chart, cls).reduce((s, m) => s + m.frequency, 0);
      expect(total).toBeCloseTo(1, 9);
    }
  });

  it("opens the nuts always and the trash never", () => {
    const chart = requireChart("cash-100bb-RFI-UTG");
    expect(evaluateHand(chart, "AA").find((m) => m.type === "raise")?.frequency).toBe(1);
    expect(evaluateHand(chart, "72o").find((m) => m.type === "fold")?.frequency).toBe(1);
  });

  it("represents a mixed-frequency hand as two actions", () => {
    const chart = requireChart("cash-100bb-RFI-UTG");
    const mix = evaluateHand(chart, "65s");
    expect(mix.find((m) => m.type === "raise")?.frequency).toBeCloseTo(0.5);
    expect(mix.find((m) => m.type === "fold")?.frequency).toBeCloseTo(0.5);
  });
});

describe("findChart", () => {
  it("locates a chart by query", () => {
    const chart = findChart({ format: "cash", stackBB: 100, position: "CO", scenario: "RFI" });
    expect(chart?.id).toBe("cash-100bb-RFI-CO");
  });
});
