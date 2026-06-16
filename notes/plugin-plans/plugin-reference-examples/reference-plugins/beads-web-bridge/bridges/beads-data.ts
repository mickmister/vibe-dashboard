export const methods = {
  async 'beads.list'() {
    return [];
  },
  async 'beads.get'(input: { id: string }) {
    return { id: input.id, found: false };
  },
  async 'beads.updateStatus'(input: { id: string; status: string }) {
    return { id: input.id, status: input.status };
  },
};
