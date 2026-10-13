import { describe, expect, it } from 'vitest';
import { browserAssistantPlacement, browserPopupFeatures, browserFrameInset } from './browserWindowLayout';
describe('浏览器右侧独立助手布局', () => {
  it('右侧间隔 4px、顶边对齐、外窗同高，不修改主窗口', () => {
    const main = { x: 80, y: 40, width: 900, height: 920 }, before = { ...main };
    const target = browserAssistantPlacement(main, { x: 0, y: 0, width: 1920, height: 1080 });
    expect(target).toEqual({ x: 984, y: 40, width: 440, height: 920, fitsRight: true }); expect(main).toEqual(before);
    expect(browserPopupFeatures(target)).toBe('popup,width=440,height=920,left=984,top=40');
    // Windows snapped windows may include an invisible 8px border outside the work area.
    expect(browserAssistantPlacement({ x: 80, y: -8, width: 900, height: 1096 }, { x: 0, y: 0, width: 1920, height: 1080 }).fitsRight).toBe(true);
  });
  it('支持负坐标显示器；调整主窗口后使用其最新尺寸与位置', () => {
    const work = { x: -1920, y: -100, width: 1920, height: 1080 };
    expect(browserAssistantPlacement({ x: -1800, y: -60, width: 900, height: 900 }, work)).toEqual({ x: -896, y: -60, width: 440, height: 900, fitsRight: true });
    expect(browserAssistantPlacement({ x: -1700, y: 10, width: 1000, height: 750 }, work, 480)).toEqual({ x: -696, y: 10, width: 480, height: 750, fitsRight: true });
  });
  it('补偿 Windows 两侧不可见边框，实际可见边缘仍有正间距；不将缩放或开发工具宽度全算作边框', () => {
    const mainFrame = browserFrameInset(900, 884, true), assistantFrame = browserFrameInset(440, 424, true);
    const main = { x: 80, y: 40, width: 900, height: 920 }, target = browserAssistantPlacement(main, { x: 0, y: 0, width: 1920, height: 1080 }, 440, { main: mainFrame, assistant: assistantFrame });
    expect(target.x).toBe(968); expect((target.x + assistantFrame) - (main.x + main.width - mainFrame)).toBe(4);
    expect(browserFrameInset(900, 500, true)).toBe(8); expect(browserFrameInset(900, 1100, true)).toBe(0); expect(browserFrameInset(900, 884, false)).toBe(0);
  });
  it('空间不足只标记不能容纳，不缩小或移动主阅读器', () => {
    const main = Object.freeze({ x: 0, y: 0, width: 1280, height: 900 });
    const target = browserAssistantPlacement(main, { x: 0, y: 0, width: 1280, height: 900 });
    expect(target.fitsRight).toBe(false); expect(target.x).toBe(1284); expect(main.width).toBe(1280); expect(target.height).toBe(900);
  });
});
