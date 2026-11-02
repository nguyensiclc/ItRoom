---
mô_tả: Model Claude dùng cho từng loại việc. Server đọc lại file này mỗi lượt nói, sửa xong là có hiệu lực ngay.
smalltalk: haiku
work: sonnet
plan: opus
boss: sonnet
agy_smalltalk: gemini-3.8-flash-low
agy_work: gemini-3.8-flash-medium
agy_plan: gemini-3.8-flash-high
agy_boss: gemini-3.8-flash-medium
---

# Chọn model theo loại việc

Mỗi câu thoại thuộc một loại việc. Server dùng model ghi ở phần đầu file cho loại việc đó.
Agent vẫn giữ nguyên trí nhớ khi đổi model, vì model chỉ đổi theo từng lượt nói trong cùng một session.

| Loại việc | Khi nào | Mặc định |
|---|---|---|
| `smalltalk` | Tán gẫu lúc rảnh | `haiku`: rẻ và nhanh nhất |
| `work` | Code, review, test, bàn giao giữa các agent, làm việc riêng | `sonnet` |
| `plan` | Họp việc chung: PM tóm tắt, chọn phần việc, mọi người nêu kế hoạch, chốt phân công | `opus`: suy nghĩ kỹ nhất |
| `boss` | Trả lời sếp, nhận việc riêng, báo cáo kết quả | `sonnet` |

Giá trị hợp lệ: `haiku`, `sonnet`, `opus` (bản mới nhất của mỗi dòng), tên model đầy đủ như `claude-sonnet-5-5`,
hoặc để trống để dùng model mặc định đang đặt trong Claude Code.

## Agent chạy bằng Antigravity CLI (`agy`)

Agent nào có dòng `cli: antigravity` ở đầu file persona (hiện là `PM.md` và `Tester.md`) thì nói bằng `agy` thay cho `claude`,
và dùng các khoá `agy_*` ở trên. Xem danh sách model bằng lệnh `agy models`
(ví dụ `gemini-3.8-flash-low/medium/high`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`).
Đổi `cli:` của một agent thì agent đó bắt đầu session mới (hai CLI không dùng chung trí nhớ).
