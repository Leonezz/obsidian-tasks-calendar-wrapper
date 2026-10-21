import { test } from "node:test";
import assert from "node:assert/strict";

import { hodgesLehmann, signedRank } from "../scripts/bench-stats.mjs";

// The A/B mode of scripts/bench.mjs judges paired rounds with these, as R's wilcox.test(paired = TRUE, conf.int = TRUE)
// and Chromium's try-job analysis do.

test("the signed-rank test matches R on its own example", () => {
	// R's ?wilcox.test, the depression scores before and after treatment: V = 40, two-sided p-value = 0.03906.
	const x = [1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3];
	const y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
	const result = signedRank(x.map((value, i) => value - y[i]));
	assert.equal(result.n, 9);
	assert.equal(result.wPlus, 40);
	assert.equal(result.p, 20 / 512);
});

test("six pairs that all agree are the fewest that can reach p < 0.05", () => {
	assert.equal(signedRank([1, 2, 3, 4, 5, 6]).p, 2 / 64);
	assert.equal(signedRank([-1, -2, -3, -4, -5, -6]).p, 2 / 64);
	assert.equal(signedRank([1, 2, 3, 4, 5]).p, 2 / 32);
	// Three runs per arm without pairing could never get there; five pairs cannot either.
	assert.ok(signedRank([1, 2, 3, 4, 5]).p > 0.05);
});

test("pairs without a difference are left out, and with none left nothing is found", () => {
	assert.deepEqual(signedRank([0, 0, 1, 2, 3, 4, 5, 6]), { n: 6, wPlus: 21, p: 2 / 64 });
	assert.deepEqual(signedRank([0, 0, 0, 0, 0, 0]), { n: 0, wPlus: 0, p: 1 });
});

test("tied differences share their rank, and the p-value is exact for those ranks", () => {
	// Ranks 1.5, 1.5, 3.5, 3.5; W+ = 8.5. Of the 16 ways to sign them, 3 reach 8.5 or more.
	assert.deepEqual(signedRank([1, -1, 2, 2]), { n: 4, wPlus: 8.5, p: 6 / 16 });
	assert.deepEqual(signedRank([-1, 1, -2, -2]), { n: 4, wPlus: 1.5, p: 6 / 16 });
});

test("a p-value never exceeds 1", () => {
	assert.equal(signedRank([1, -1]).p, 1);
	assert.equal(signedRank([3]).p, 1);
});

test("the Hodges-Lehmann estimate is the median of the Walsh averages, with R's exact interval", () => {
	assert.deepEqual(hodgesLehmann([1, 2, 3, 4, 5, 6]), { estimate: 3.5, low: 1, high: 6, level: 1 - 2 / 64 });
	assert.deepEqual(hodgesLehmann([8, 1, 7, 2, 6, 3, 5, 4]), { estimate: 4.5, low: 2, high: 7, level: 1 - 10 / 256 });
	assert.deepEqual(hodgesLehmann([3, 3, 3, 3, 3, 3]), { estimate: 3, low: 3, high: 3, level: 1 - 2 / 64 });
});

test("the estimate keeps differences of zero and shrugs off one outlier", () => {
	assert.equal(hodgesLehmann([0, 0, 0, 0, 0, 0]).estimate, 0);
	assert.equal(hodgesLehmann([1, 1, 1, 1, 1, 100]).estimate, 1);
});

test("too few pairs for the confidence asked give the widest interval, and say how sure it is", () => {
	// R: "requested conf.level not achievable"; five pairs reach 1 - 2/32.
	assert.deepEqual(hodgesLehmann([1, 2, 3, 4, 5]), { estimate: 3, low: 1, high: 5, level: 1 - 2 / 32 });
	assert.throws(() => hodgesLehmann([]), /no pairs/);
});
