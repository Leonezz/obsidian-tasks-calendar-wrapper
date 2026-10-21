/**
 * The statistics of the benchmark's A/B mode, scripts/bench-ab.mjs: the two-sided Wilcoxon signed-rank test of paired
 * differences, and the Hodges-Lehmann estimate of their middle with its confidence interval, as R's
 * `wilcox.test(paired = TRUE, conf.int = TRUE)` computes them. Chromium's try jobs judge a change the same way (CABE),
 * on the logarithms of the paired ratios. Plain arithmetic, so tests/benchstats.test.ts can test it.
 */

const sortNumbers = (values) => [...values].sort((a, b) => a - b);

const median = (values) => {
	const sorted = sortNumbers(values);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The ranks of `values` from the smallest, 1 to n; tied values share the average of their ranks. */
function ranks(values) {
	const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
	const result = new Array(values.length);
	for (let start = 0; start < order.length;) {
		let end = start;
		while (end + 1 < order.length && order[end + 1].value === order[start].value) end++;
		const rank = (start + end) / 2 + 1;
		for (let i = start; i <= end; i++) result[order[i].index] = rank;
		start = end + 1;
	}
	return result;
}

/**
 * For whole-number `weights`, how many of their 2^n subsets add up to each sum: the distribution of the signed-rank
 * statistic when every sign is as likely as the other.
 */
function subsetSums(weights) {
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const ways = new Array(total + 1).fill(0);
	ways[0] = 1;
	let reach = 0;
	for (const weight of weights) {
		for (let sum = reach; sum >= 0; sum--) if (ways[sum]) ways[sum + weight] += ways[sum];
		reach += weight;
	}
	return ways;
}

/** P(W+ <= x) for n pairs without ties, R's psignrank. */
function signedRankCdf(n, x) {
	const ways = subsetSums(Array.from({ length: n }, (_, i) => i + 1));
	let below = 0;
	for (let sum = 0; sum <= Math.min(x, ways.length - 1); sum++) below += ways[sum];
	return below / 2 ** n;
}

/**
 * The two-sided Wilcoxon signed-rank test of `differences` against 0. Differences of 0 are left out, as in Wilcoxon's
 * test and R. Tied absolute differences share their average rank, and the p-value is exact for those ranks: the share of
 * the 2^n ways to sign them whose W+ is at least as far from the middle as the one observed.
 */
export function signedRank(differences) {
	const nonZero = differences.filter((difference) => difference !== 0);
	const n = nonZero.length;
	if (n === 0) return { n: 0, wPlus: 0, p: 1 };
	// Average ranks are whole or halves; doubled, they are whole numbers to count sums of.
	const doubled = ranks(nonZero.map(Math.abs)).map((rank) => rank * 2);
	const observed = doubled.reduce((sum, rank, i) => sum + (nonZero[i] > 0 ? rank : 0), 0);
	const ways = subsetSums(doubled);
	let atMost = 0;
	let atLeast = 0;
	ways.forEach((count, sum) => {
		if (sum <= observed) atMost += count;
		if (sum >= observed) atLeast += count;
	});
	const p = Math.min(1, (2 * Math.min(atMost, atLeast)) / 2 ** n);
	return { n, wPlus: observed / 2, p };
}

/**
 * The Hodges-Lehmann estimate of the middle of `differences`, the median of their Walsh averages (the means of every
 * pair, each value with itself too), and its confidence interval as R's exact wilcox.test gives it: the Walsh averages
 * that the signed-rank test's quantiles cut off. With too few differences for the confidence asked, the interval is
 * the widest there is, and `level` says the confidence it has. Differences of 0 are kept: they pull the estimate
 * towards no change.
 */
export function hodgesLehmann(differences, confidence = 0.95) {
	const n = differences.length;
	if (n === 0) throw new Error("hodgesLehmann: no pairs to estimate from");
	const walsh = [];
	for (let i = 0; i < n; i++) for (let j = i; j < n; j++) walsh.push((differences[i] + differences[j]) / 2);
	const sorted = sortNumbers(walsh);
	const alpha = 1 - confidence;
	// R's qsignrank(alpha / 2, n): the smallest W+ with P(W+ <= it) >= alpha / 2, at least 1.
	let lower = 0;
	while (signedRankCdf(n, lower) < alpha / 2) lower++;
	lower = Math.max(lower, 1);
	return {
		estimate: median(sorted),
		low: sorted[lower - 1],
		high: sorted[sorted.length - lower],
		level: 1 - 2 * signedRankCdf(n, lower - 1),
	};
}
