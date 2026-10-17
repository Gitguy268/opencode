export * as WebSearchSearXNG from "./searxng.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Duration, Effect, Schema, Scope } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { App } from "../../app.js"

const SearchResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      url: Schema.String,
      content: Schema.NullOr(Schema.String).pipe(Schema.optional),
    }),
  ),
})

export const Plugin = define<HttpClient.HttpClient | Scope.Scope>({
  id: "opencode.websearch.searxng",
  effect: Effect.fn("WebSearchSearXNG.Plugin")(function* (ctx) {
    // Self-hosted, so only offered when configured; an unreachable instance would break "random" selection.
    const base = process.env.SEARXNG_URL
    if (!base) return
    const http = yield* HttpClient.HttpClient
    yield* ctx.websearch.transform((editor) => {
      editor.add({
        id: "searxng",
        name: "SearXNG",
        execute: (input) =>
          Effect.gen(function* () {
            const url = new URL("search", base.endsWith("/") ? base : `${base}/`)
            url.searchParams.set("q", input.query)
            url.searchParams.set("format", "json")
            const request = HttpClientRequest.get(url.toString()).pipe(
              HttpClientRequest.acceptJson,
              HttpClientRequest.setHeaders({ "User-Agent": App.useragent(ctx.app) }),
            )
            const response = yield* HttpClient.withScope(HttpClient.filterStatusOk(http))
              .execute(request)
              .pipe(
                Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
                Effect.scoped,
                Effect.timeoutOrElse({
                  duration: Duration.seconds(25),
                  orElse: () => Effect.fail(new Error("SearXNG web search request timed out")),
                }),
              )
            return response.results.slice(0, 8).map((item) => ({
              url: item.url,
              title: item.title,
              ...(item.content ? { content: item.content } : {}),
              time: {},
            }))
          }),
      })
    })
  }),
})
