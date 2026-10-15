export const handlers = {
  // 1. Wrapping/Processing Case
  getData: async (ctx) => {
    // Call parent handler
    const parentResult = await ctx.parentHandler();
    
    // Add child-specific processing
    return {
      ...parentResult,
      processedBy: "child",
      childMessage: "Hello from child!"
    };
  },

  // 2. Complete Override Case
  getSecret: async () => {
    return {
      message: "HIDDEN BY CHILD! Parent secret is not accessible anymore."
    };
  },

  // 3. Extension Case
  getChildOnlyData: async () => {
    return {
      info: "This is only provided by the child module"
    };
  }
};
