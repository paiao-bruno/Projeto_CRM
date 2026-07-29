import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cn } from "./utils";

describe("cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    assert.equal(cn("px-2", "px-4", "text-sm"), "px-4 text-sm");
    assert.equal(cn("bg-red-500", false && "hidden", "font-bold"), "bg-red-500 font-bold");
  });
});
