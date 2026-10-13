// 在章节被序列化为 iframe 文档之前注入 CSP；不能等 iframe 加载后才限制资源。
export function hardenChapter(document: Document): void {
  const namespace = 'http://www.w3.org/1999/xhtml';
  const head = document.querySelector('head');
  if (!head) throw new Error('章节缺少 head，暂时无法安全显示。');
  document.querySelectorAll('script, iframe, object, embed, form, base, meta[http-equiv], link[rel="preload"], link[rel="prefetch"]').forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || attribute.name === 'srcdoc') element.removeAttribute(attribute.name);
    }
  });
  document.querySelectorAll('a').forEach((anchor) => {
    // 首版不允许书内链接导航到网络或系统协议，保留章节和脚注的相对链接。
    for (const attribute of Array.from(anchor.attributes)) {
      if (attribute.localName === 'href' && /^(?:[a-z][\w+.-]*:|\/\/)/i.test(attribute.value.trim())) {
        anchor.removeAttributeNode(attribute);
      }
    }
    anchor.removeAttribute('target');
    anchor.removeAttribute('ping');
    anchor.removeAttribute('download');
  });
  const policy = document.createElementNS(namespace, 'meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; media-src blob: data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
  head.insertBefore(policy, head.firstChild);
}
