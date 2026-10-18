/**
 * Optimal string alignment distance (Levenshtein plus adjacent transposition),
 * with an early exit once the distance is known to exceed `max`.
 */
export function editDistance(
	a: string,
	b: string,
	max = Number.POSITIVE_INFINITY,
): number {
	if (a === b) return 0;
	if (Math.abs(a.length - b.length) > max) return max + 1;
	const n = a.length;
	const m = b.length;
	if (n === 0) return m;
	if (m === 0) return n;
	let prev2 = new Array<number>(m + 1).fill(0);
	let prev = Array.from({ length: m + 1 }, (_, j) => j);
	let cur = new Array<number>(m + 1).fill(0);
	for (let i = 1; i <= n; i++) {
		cur[0] = i;
		let rowMin = cur[0];
		for (let j = 1; j <= m; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				v = Math.min(v, prev2[j - 2] + 1);
			}
			cur[j] = v;
			if (v < rowMin) rowMin = v;
		}
		if (rowMin > max) return max + 1;
		[prev2, prev, cur] = [prev, cur, prev2];
	}
	return prev[m];
}

/** How many typos to tolerate for a word of this length. Short words get none. */
export function typoBudget(length: number): number {
	if (length < 4) return 0;
	if (length < 8) return 1;
	return 2;
}
