import { describe, expect, it } from 'vitest';
import { hasRenderableDiff, parseRepoPatch } from './diffPatch';

describe('parseRepoPatch', () => {
  it('returns each file from a multi-file git patch', () => {
    const patch = `diff --git a/a.txt b/a.txt
index 0000000..1111111 100644
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+b
diff --git a/b.txt b/b.txt
index 0000000..1111111 100644
--- a/b.txt
+++ b/b.txt
@@ -1 +1 @@
-c
+d
`;

    const result = parseRepoPatch(patch, 'test');

    expect(result.error).toBeNull();
    expect(result.files.map((file) => file.name)).toEqual(['a.txt', 'b.txt']);
    expect(result.files.every(hasRenderableDiff)).toBe(true);
  });

  it('keeps binary or metadata-only files as safe non-renderable entries', () => {
    const patch = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..1111111
Binary files /dev/null and b/image.png differ
`;

    const result = parseRepoPatch(patch, 'binary');

    expect(result.error).toBeNull();
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.name).toBe('image.png');
    expect(hasRenderableDiff(result.files[0]!)).toBe(false);
  });
});
