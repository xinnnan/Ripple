import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import robots from "./robots";
import GlobalError from "./global-error";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("root failure boundary", () => {
  it("renders its own document because it replaces the root layout", () => {
    const error = Object.assign(new Error("database host 10.0.0.5 refused"), {
      digest: "abc123",
    });
    const html = renderToStaticMarkup(
      <GlobalError error={error} reset={() => undefined} />
    );

    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain("<body");
    expect(html).toContain("Something went wrong");
    expect(html).toContain("abc123");
    expect(html).toContain("Try again");
    // Raw error messages can carry infrastructure details.
    expect(html).not.toContain("10.0.0.5");
  });
});

describe("robots policy", () => {
  it("keeps the app, API, and token-bearing share links out of crawlers", () => {
    const policy = robots();
    const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
    const disallow = rules.flatMap((rule) =>
      Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow ?? ""]
    );

    for (const path of [
      "/api/",
      "/t/",
      "/dashboard",
      "/tickets",
      "/admin",
      "/field-service",
      "/part-requests",
    ]) {
      expect(disallow).toContain(path);
    }
    expect(rules[0].allow).toEqual(["/", "/submit"]);
  });
});
