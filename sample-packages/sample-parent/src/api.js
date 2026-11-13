/** Sample package value or fixture named handlers. */
export const handlers = {
  getData: async () => {
    return {
      source: 'parent',
      items: ['Item 1', 'Item 2'],
    };
  },
  getSecret: async () => {
    return {
      message: 'This is a parent secret',
    };
  },
};
