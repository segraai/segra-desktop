import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSearchExecutor, parseDuckDuckGoResults } from "./web-search";

const RESULTS_HTML = `
<div class="result results_links results_links_deep result--ad ">
  <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=shop.example">Buy now</a>
  <a class="result__snippet" href="https://duckduckgo.com/y.js?ad_domain=shop.example">An ad</a>
</div>
<div class="result results_links results_links_deep web-result ">
  <a rel="nofollow" class="result__a" href="https://www.espn.com/nba/scoreboard">NBA Scores, 2026-27 Season - <b>ESPN</b></a>
  <a class="result__snippet" href="https://www.espn.com/nba/scoreboard">Live <b>scores</b> &amp; results for every game.</a>
</div>
<div class="result results_links results_links_deep web-result ">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.nba.com%2Fgames&amp;rut=abc">Games | NBA.com</a>
</div>
`;

describe("parseDuckDuckGoResults", () => {
	it("extracts organic results, skips ads, and resolves redirect links", () => {
		expect(parseDuckDuckGoResults(RESULTS_HTML)).toEqual([
			{
				title: "NBA Scores, 2026-27 Season - ESPN",
				url: "https://www.espn.com/nba/scoreboard",
				snippet: "Live scores & results for every game.",
			},
			{
				title: "Games | NBA.com",
				url: "https://www.nba.com/games",
				snippet: "",
			},
		]);
	});
});

describe("createWebSearchExecutor", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("posts the query and formats the results", async () => {
		const fetchMock = vi.fn(
			async () => new Response(RESULTS_HTML, { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const search = createWebSearchExecutor({
			endpoint: "https://search.test/html/",
		});
		const output = await search("nba scores", {} as never);

		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://search.test/html/");
		expect(init.method).toBe("POST");
		expect(init.body).toBe("q=nba+scores");
		expect(output).toContain('Search results for "nba scores":');
		expect(output).toContain(
			"1. NBA Scores, 2026-27 Season - ESPN\n   https://www.espn.com/nba/scoreboard",
		);
		expect(output).not.toContain("Buy now");
	});

	it("reports a bot check instead of returning empty results", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response("<form id=challenge-form>anomaly</form>", {
						status: 202,
					}),
			),
		);
		const search = createWebSearchExecutor();
		await expect(search("nba scores", {} as never)).rejects.toThrow(
			"bot check",
		);
	});
});
