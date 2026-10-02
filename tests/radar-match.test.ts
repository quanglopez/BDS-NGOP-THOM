import assert from "node:assert/strict";
import { signalLabels } from "@/lib/radar/format";
import type { RadarMatch } from "@/lib/radar/types";

const base: RadarMatch = {
  externalId: "radar-test",
  url: null,
  title: null,
  areaName: null,
  regionName: null,
  categoryCode: null,
  priceVnd: null,
  sizeM2: null,
  pricePerM2: null,
  listedAt: null,
  lastSeenAt: null,
  score: null,
  dealType: null,
  isNgoP: null,
  scoringAvailable: false,
  comparison: null,
  firstMatchedAt: "2026-10-02T00:00:00Z",
  lastMatchedAt: "2026-10-02T00:00:00Z",
  currentMatch: false,
};

assert.deepEqual(signalLabels(base), []);
assert.deepEqual(
  signalLabels({
    ...base,
    comparison: {
      medianPpm2: 1,
      differencePercent: -12,
      confidence: "low",
      scopeDescription: "x",
    },
  }),
  ["Giá thấp hơn tham chiếu 12%", "Độ tin cậy tham chiếu: Thấp"],
);

const zeroScore: RadarMatch = { ...base, score: 0 };
assert.equal(zeroScore.score, 0);