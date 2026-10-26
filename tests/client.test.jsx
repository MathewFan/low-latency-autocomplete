// @vitest-environment jsdom
import React from "react";
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../client/App.jsx";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const payload = {
  items: [
    { id: "1", label: "React", category: "Frontend" },
    { id: "2", label: "React Native", category: "Frontend" },
  ],
  durationMs: 1,
  cache: "miss",
};
function mockFetch(
  handler = () => Promise.resolve({ ok: true, json: async () => payload }),
) {
  const fn = vi.fn((url, options) =>
    url === "/api/health"
      ? Promise.resolve({
          ok: true,
          json: async () => ({ storage: "mongodb" }),
        })
      : handler(url, options),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}
it("searches examples, supports keyboard selection, escape, and clearing", async () => {
  mockFetch();
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole("button", { name: /^react/ }));
  await screen.findByRole("option", { name: /React Native/ });
  const input = screen.getByRole("combobox");
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByRole("heading", { name: /React/ })).toBeTruthy();
  expect(input.getAttribute("aria-expanded")).toBe("false");
  await user.click(input);
  await user.keyboard("{Escape}");
  expect(input.getAttribute("aria-expanded")).toBe("false");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(input.value).toBe("");
});
it("debounces rapid input into one request", async () => {
  const fetch = mockFetch();
  render(<App />);
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "r" } });
  fireEvent.change(input, { target: { value: "re" } });
  fireEvent.change(input, { target: { value: "react" } });
  await screen.findByRole("option", { name: /React Native/ });
  expect(
    fetch.mock.calls.filter(([url]) => url.startsWith("/api/suggest")),
  ).toHaveLength(1);
});
it("ignores stale responses even if a transport ignores abort", async () => {
  let finishOld;
  mockFetch((url) =>
    url.includes("q=old")
      ? new Promise((r) => {
          finishOld = r;
        })
      : Promise.resolve({ ok: true, json: async () => payload }),
  );
  render(<App />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "old" } });
  await waitFor(() => expect(finishOld).toBeTypeOf("function"));
  fireEvent.change(input, { target: { value: "react" } });
  await screen.findByRole("option", { name: /React Native/ });
  finishOld({
    ok: true,
    json: async () => ({
      ...payload,
      items: [{ id: "99", label: "Old result", category: "Test" }],
    }),
  });
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByText("Old result")).toBeNull();
});
it("handles empty results and network failures", async () => {
  mockFetch(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({ ...payload, items: [] }),
    }),
  );
  render(<App />);
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "zzz" } });
  await screen.findByText("No matches yet. Try a shorter prefix.");
  cleanup();
  mockFetch(() => Promise.resolve({ ok: false }));
  render(<App />);
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "err" } });
  await screen.findByText("Couldn’t reach search. Try again.");
});
it("supports pointer selection and arrow up", async () => {
  mockFetch();
  render(<App />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "react" } });
  const option = await screen.findByRole("option", { name: /React Native/ });
  fireEvent.keyDown(input, { key: "ArrowUp" });
  expect(input.getAttribute("aria-activedescendant")).toBe("option-1");
  fireEvent.mouseEnter(option);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
  expect(screen.getByRole("heading", { name: /React Native/ })).toBeTruthy();
});

it("can compare strict search with typo recovery and inspect ranking", async () => {
  const fetch = mockFetch(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({
        ...payload,
        query: "reaxt",
        storage: "mongodb",
        search: {
          strategy: "typo-fallback",
          candidateCount: 3,
          retrievalMs: 1.2,
          rankingMs: 0.1,
        },
        items: [
          {
            id: "1",
            label: "React",
            category: "Frontend",
            score: 22,
            explanation: {
              matchType: "typo",
              matchedPrefix: "react",
              editDistance: 1,
            },
          },
        ],
      }),
    }),
  );
  const user = userEvent.setup();
  render(<App />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "reaxt" } });
  await screen.findByText("A small typo? These are the closest matches.");
  await user.click(screen.getByText("Explain this search"));
  expect(screen.getByRole("table", { name: "Why this order?" })).toBeTruthy();
  expect(screen.getByText("One typo corrected")).toBeTruthy();
  expect(screen.getByText("Matched “react”")).toBeTruthy();
  await user.click(screen.getByRole("checkbox", { name: "Allow one typo" }));
  await waitFor(() =>
    expect(fetch.mock.calls.some(([url]) => url.includes("fuzzy=false"))).toBe(
      true,
    ),
  );
});
it("lets a failed request retry without editing the query", async () => {
  let failing = true;
  mockFetch(() =>
    Promise.resolve(
      failing ? { ok: false } : { ok: true, json: async () => payload },
    ),
  );
  const user = userEvent.setup();
  render(<App />);
  fireEvent.focus(screen.getByRole("combobox"));
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "react" },
  });
  const retry = await screen.findByRole("button", { name: "Retry search" });
  failing = false;
  await user.click(retry);
  await screen.findByRole("option", { name: /React Native/ });
});
it("bounds the inspector trace to the last eight successful requests", async () => {
  mockFetch(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({
        ...payload,
        search: {
          strategy: "prefix",
          candidateCount: 2,
          retrievalMs: 1,
          rankingMs: 0.1,
        },
      }),
    }),
  );
  render(<App />);
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  for (let i = 0; i < 9; i++) {
    fireEvent.change(input, { target: { value: `query${i}` } });
    await screen.findByRole("option", { name: /React Native/ });
  }
  expect(screen.getByText("Your last 8 requests")).toBeTruthy();
  const trace = screen.getByRole("list", {
    name: "Recent request timings",
    hidden: true,
  });
  expect(trace.children).toHaveLength(8);
  expect(trace.textContent).not.toContain("query0");
});
