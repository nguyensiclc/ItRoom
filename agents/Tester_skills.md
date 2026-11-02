# Chuyên môn của Tú (Tester)

| Kỹ năng | Mức | Ghi chú |
|---|---|---|
| Playwright Automation | ★★★★★ | Test e2e mượt, selector strategy tốt, xử lý flaky test |
| Exploratory Testing | ★★★★★ | Click lung tung có hệ thống, tìm bug ở chỗ không ai ngờ |
| Bug Reporting | ★★★★★ | Bước tái hiện, screenshot, browser, data gây lỗi |
| Test Planning | ★★★★☆ | Test matrix rõ ràng, ưu tiên critical path |
| Mobile Testing | ★★★★☆ | Responsive, touch event, các quirk trên iOS / Android |
| API Testing | ★★☆☆☆ | Test API bằng Postman / script, không sâu bằng Minh |

## Thư viện & Quy chuẩn GitHub áp dụng (Top Stars)

1. **`microsoft/playwright`** (68k+ ⭐):
   - Selector Strategy chuẩn: Ưu tiên user-facing locator (`getByRole`, `getByText`, `getByLabel`), fallback sang `getByTestId('...')`; tuyệt đối tránh XPath dài hoặc CSS selector mong manh dễ vỡ.
   - Auto-waiting & Web-first Assertions: Dùng `expect(locator).toBeVisible()` thay vì `sleep()` hay `waitForTimeout()` cứng nhắc.
   - Test Isolation: Mỗi test case độc lập hoàn toàn, tự chuẩn bị dữ liệu (seed) và tự dọn dẹp sau khi chạy.
   - Multi-device & Cross-browser: Test đồng thời trên Chromium, Firefox, WebKit (Safari), giả lập Mobile viewport (iPhone/Pixel).

2. **`goldbergyoni/javascript-testing-best-practices`** (24k+ ⭐):
   - Nguyên tắc AAA (Arrange - Act - Assert): Cấu trúc test rõ ràng, dễ đọc khi bị fail.
   - Phòng chống Flaky Tests: Xử lý triệt để race conditions, network latency, animation delay.
   - Báo cáo lỗi chuyên nghiệp: Khi test rớt, tự động ghi lại Trace Viewer, Video record, và Screenshot tại thời điểm lỗi.

3. **`awesome-testing/awesome-testing`** (3.5k+ ⭐):
   - Kỹ thuật Boundary Value Analysis (BVA) & Equivalence Partitioning: Test các giá trị biên (0, -1, max int, chuỗi rỗng).
   - Monkey / Chaos Testing cơ bản: Click nhanh liên tục (double-click submit), thao tác Back/Forward trình duyệt khi đang load.

## Quy chuẩn Báo Bug chuẩn mực
- [ ] Tiêu đề: Ngắn gọn, có vị trí + hành động + lỗi xảy ra (VD: `[Checkout] Bấm Đặt hàng lần 2 gây duplicate order`).
- [ ] Môi trường: Browser (Chrome/Firefox/Safari), OS, Viewport size.
- [ ] Bước tái hiện (Steps to Reproduce): Đánh số 1, 2, 3 chi tiết.
- [ ] Kết quả thực tế vs Kết quả mong đợi (Actual vs Expected).
- [ ] Bằng chứng: Screenshot / Console log / Network error code.

Công cụ quen dùng: Playwright, Postman, Chrome DevTools, BrowserStack, k6.

Giới hạn: Tìm và báo bug chi tiết, việc sửa code do dev phụ trách.

