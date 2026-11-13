import {
  isSupportTopic,
  SUPPORT_TOPIC_COPY,
  SUPPORT_TOPICS,
  SupportRequestResponseSchema,
} from "../support";

describe("support topics", () => {
  it("has a label and a line of detail for every topic the backend accepts", () => {
    for (const topic of SUPPORT_TOPICS) {
      expect(SUPPORT_TOPIC_COPY[topic].label).not.toBe("");
      expect(SUPPORT_TOPIC_COPY[topic].detail).not.toBe("");
    }
    expect(Object.keys(SUPPORT_TOPIC_COPY).sort()).toEqual(
      [...SUPPORT_TOPICS].sort()
    );
  });

  it.each(SUPPORT_TOPICS)("accepts %s as a topic", (topic) => {
    expect(isSupportTopic(topic)).toBe(true);
  });

  it.each([["billing"], [""], [undefined], [["payments"]], [3]])(
    "refuses %p, which a route parameter can carry",
    (value) => {
      expect(isSupportTopic(value)).toBe(false);
    }
  );
});

describe("what the backend answers with", () => {
  it("reads a support reply with no address to answer to", () => {
    expect(
      SupportRequestResponseSchema.parse({ id: "s1", replyTo: null })
    ).toEqual({ id: "s1", replyTo: null });
  });

  it("refuses a support reply that leaves the address out", () => {
    expect(SupportRequestResponseSchema.safeParse({ id: "s1" }).success).toBe(
      false
    );
  });
});
