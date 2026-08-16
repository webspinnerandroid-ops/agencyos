import { describe, expect, it } from "vitest";
import { isDisposableEmail } from "./disposable-email";

describe("isDisposableEmail", () => {
  it("blocks known disposable domains", () => {
    expect(isDisposableEmail("spammer@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@yopmail.com")).toBe(true);
    expect(isDisposableEmail("x@10minutemail.com")).toBe(true);
    expect(isDisposableEmail("x@guerrillamail.net")).toBe(true);
    expect(isDisposableEmail("x@temp-mail.org")).toBe(true);
  });

  it("blocks the random-alphanumeric spam domains seen in the wild", () => {
    expect(isDisposableEmail("bbjblmztjcihituapa@jbsze.net")).toBe(true);
    expect(isDisposableEmail("dhaefzixcofahbmtcr@jbsze.net")).toBe(true);
    expect(isDisposableEmail("x@zhcne.com")).toBe(true);
  });

  it("allows normal email domains", () => {
    expect(isDisposableEmail("mike@giantbyte.com")).toBe(false);
    expect(isDisposableEmail("person@gmail.com")).toBe(false);
    expect(isDisposableEmail("ceo@company.co.uk")).toBe(false);
    expect(isDisposableEmail("dev@outlook.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isDisposableEmail("Spammer@Mailinator.COM")).toBe(true);
    expect(isDisposableEmail("x@Jbsze.Net")).toBe(true);
  });

  it("handles garbage input safely", () => {
    expect(isDisposableEmail(undefined)).toBe(false);
    expect(isDisposableEmail(null)).toBe(false);
    expect(isDisposableEmail("")).toBe(false);
    expect(isDisposableEmail("notanemail")).toBe(false);
    expect(isDisposableEmail("@mailinator.com")).toBe(true);
  });
});
