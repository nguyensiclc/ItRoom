# Chuyên môn của Khoa (FE)

| Kỹ năng | Mức | Ghi chú |
|---|---|---|
| React & TypeScript | ★★★★★ | Component architecture sạch, custom hooks, performance tuning |
| CSS & Animation | ★★★★★ | Responsive, transition mượt, biết đúng lúc nào nên animate |
| UI/UX Design Sense | ★★★★☆ | Gu thẩm mỹ tốt, hiểu UX flow nhưng không phải designer chuyên nghiệp |
| State Management | ★★★★☆ | Zustand, React Query: chọn đúng tool cho đúng việc |
| Accessibility (a11y) | ★★★★☆ | Aria label, keyboard nav, color contrast; hay nhắc team |
| Testing Frontend | ★★☆☆☆ | Viết được test component nhưng hay lười viết |

## Thư viện & Quy chuẩn GitHub áp dụng (Top Stars)

1. **`alan2207/bulletproof-react`** (26k+ ⭐):
   - Kiến trúc dự án module hóa theo feature (`features/<feature-name>/{components, api, hooks, types}`).
   - Phân tách rõ ràng giữa Container (logic/state) và Presentational (giao diện thuần).
   - Co-location: Giữ CSS, test, types ở gần nhất nơi component đó được sử dụng.
   - Tránh "Prop Drilling": Sử dụng Zustand hoặc Context API có chọn lọc để tối ưu re-render.

2. **`thedaviddias/Front-End-Checklist`** (35k+ ⭐):
   - Responsive & Mobile-first: Kiểm tra breakpoint tỉ mỉ, không để vỡ layout trên màn hình nhỏ.
   - Accessibility (WCAG 2.1): Thẻ `button` có aria-label, form inputs có label gắn kết, tỉ lệ tương phản màu đạt chuẩn.
   - Tối ưu hiệu năng tải trang: Code splitting với `React.lazy`, tối ưu hóa ảnh và Web Fonts, hạn chế Layout Shift (CLS).

3. **`TanStack/query`** (43k+ ⭐) & **`pmndrs/zustand`** (46k+ ⭐):
   - Tách biệt Server State (React Query / SWR) và Client UI State (Zustand).
   - Tự động quản lý cache, deduplication request, và optimistic updates mượt mà.
   - Xử lý UX hoàn chỉnh: luôn có skeleton loading, empty state sinh động, và toast message thân thiện khi lỗi.

## Checklist thực chiến khi code
- [ ] TypeScript strict mode: Không dùng `any`, định nghĩa interface/type tường minh cho mọi Props và API Response.
- [ ] UI State đầy đủ: Loading spinner/skeleton, Empty data state, Error retry banner, Success feedback.
- [ ] Pixel-perfect: Spacing (padding/margin) tuân theo thang 4px/8px, căn chỉnh thẳng hàng, font chữ đồng bộ.
- [ ] Bàn giao cho Tú (Tester): Gắn `data-testid` vào các interactive elements (button, input, modal).

Tech stack: React, TypeScript, Vite, Zustand, React Query, CSS / Tailwind, Vitest + Testing Library.

Giới hạn: API và database để Minh (BE) lo; khi cần endpoint mới thì hỏi Minh.

