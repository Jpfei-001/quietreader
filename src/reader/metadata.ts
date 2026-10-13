import { Book } from 'epubjs';

const MAX_COVER_SIZE = 2 * 1024 * 1024;

export async function inspectEpub(data: ArrayBuffer, fileName: string): Promise<{
  title: string; author: string; cover?: Blob;
}> {
  const book = new Book({
    replacements: 'blobUrl',
    requestMethod: () => Promise.reject(new Error('不允许从网络获取书籍资源。')),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await book.open(data, 'binary');
        // ready 只表示元数据就绪；opened 还等待 CSS/资源替换完成，不能提前销毁。
        await book.opened;
        await book.ready;
        const metadata = await book.loaded.metadata;
        if (metadata.layout === 'pre-paginated') throw new Error('暂不支持固定版式 EPUB，请使用可重排版电子书。');
        let cover: Blob | undefined;
        try {
          const path = book.packaging.coverPath;
          if (path && !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(path)) {
            // 直接读取压缩包，不 fetch Blob URL，也不放宽应用的网络 CSP。
            const blob = await book.archive.getBlob(book.resolve(path));
            if (blob?.type.startsWith('image/') && blob.size <= MAX_COVER_SIZE) cover = blob;
          }
        } catch {
          // 缺失、损坏或过大的封面不阻止导入，书架使用文字封面。
        }
        return {
          title: metadata.title.trim() || fileName.replace(/\.epub$/i, ''),
          author: metadata.creator.trim() || '未知作者',
          cover,
        };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('读取书籍信息超时，文件可能损坏或暂不兼容。')), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    book.destroy();
  }
}
