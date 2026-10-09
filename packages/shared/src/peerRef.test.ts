import { it, expect } from "vite-plus/test";
import { taskRef } from "./peerRef.ts";
it("keeps raw title-shaped ids opaque and stable on client/server", () => {
  expect(taskRef("krk-1")).toBe("t_ae9c96b09dfc");
  expect(taskRef("private-title-1234")).toBe("t_f37e7911d141");
  expect(taskRef("task:pay")).toBe("t_92cc8d3089da");
  expect(taskRef("krk-1")).toBe(taskRef("task:krk-1"));
  expect(taskRef()).toBe("none");
  expect(taskRef("project")).toBe("none");
  expect(taskRef("pay")).not.toBe(taskRef("krk-1"));
});
