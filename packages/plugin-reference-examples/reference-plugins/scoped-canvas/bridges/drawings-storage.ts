export const methods = {
  async 'drawings.list'() {
    return [];
  },
  async 'drawings.read'(input: { id: string }) {
    return { id: input.id, content: null };
  },
  async 'drawings.write'(input: { id: string; content: unknown }) {
    return { id: input.id, saved: true, content: input.content };
  },
};
