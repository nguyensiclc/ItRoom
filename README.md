# IT Room 3D

Phòng IT 3D với 5 agent người que, mỗi người một khoang ngồi: PM, Dev Backend (BE), Dev Frontend (FE), QA, Tester.

**Agent chỉ làm khi bạn giao việc** (ô "Giao việc" trên giao diện, hoặc dòng `giao ...` trong `office/inbox.md`):

- `giao @team <việc>`: việc chung. Cả team ra bàn họp, PM đặt tên task và chọn BE / FE / FULLSTACK, mỗi người nêu phần của mình, PM chốt phân công. Sau đó dev làm (fullstack: BE làm API rồi bàn giao FE) → QA review → Tester test → PM báo cáo bạn. Bug được giao cho đúng người phụ trách phần bị lỗi.
- `giao @FE <việc>` (hoặc @PM, @BE, @QA, @Tester): việc riêng. Chỉ người đó nhận việc, làm, rồi báo cáo bạn.

Việc làm lần lượt theo thứ tự giao. Đang có việc chung thì ai chưa tới lượt ngồi chờ ở khoang, không đi tán gẫu. Không có việc nào thì cả team ngồi chơi.

Việc giao được server giữ đến khi làm xong: tải lại trang giữa chừng thì việc đó được làm lại từ đầu. **Chỉ mở giao diện ở 1 tab**, vì mỗi tab là một phòng riêng và việc sẽ bị chia cho tab nào nhận trước.

## Chạy

```bash
npm install
npm run dev        # giao diện: http://localhost:5173
npm run server     # terminal thứ hai: agent nói chuyện qua Claude CLI
```

Server gọi `claude -p` cho từng câu thoại, dùng phiên đăng nhập Claude Code sẵn có trên máy (không cần API key). Không chạy server thì app dùng kịch bản có sẵn.

## Các file .md

| File | Vai trò |
|---|---|
| `agents/_rules.md` | Luật chung cho mọi agent (cách nói, độ dài, định dạng) |
| `agents/PM.md`, `BE.md`, `FE.md`, `QA.md`, `Tester.md` | Tính cách từng agent. Sửa file là có hiệu lực từ câu tiếp theo |
| `office/inbox.md` | Hộp thư của bạn: thêm dòng `@FE nội dung` (hoặc `@all ...`) rồi lưu |
| `office/chat/BE-QA.md`, `FE-Tester.md`... | Trò chuyện riêng giữa từng cặp agent (tạo khi hai người nói chuyện lần đầu) |
| `office/chat/team.md` | Kênh chung: thông báo task mới, standup |
| `office/chat/Sep-<Role>.md` | Trò chuyện riêng giữa bạn và từng agent |
| `office/chat.md` | Nhật ký tổng để bạn theo dõi cả phòng (agent không đọc) |

Khi nói, mỗi agent chỉ đọc 12 dòng cuối của file kênh đang nói cộng 5 tin chung của team, nên chuyện riêng giữa hai người không lộ sang người khác.

## Lúc rảnh

Agent không giữ task nào thì ngồi chơi theo sở thích: Lan đọc sách 📖, Minh chơi game 🎮, Khoa nghe nhạc 🎧, Hà xem phim 🍿, Tú xoay rubik 🧩. Thỉnh thoảng một người rảnh sang khoang người rảnh khác tán gẫu (3 câu, ghi vào file riêng của hai người). Lẩm bẩm về sở thích chỉ là câu có sẵn, không gọi Claude.

Ô chat ở góc dưới bên trái giao diện cũng ghi vào `office/inbox.md`, nên tin nhắn từ giao diện hay viết tay vào file đều đi cùng một đường.

Kết quả đạt / có lỗi trong quy trình vẫn do mô phỏng tung xúc xắc để giữ nhịp; Claude diễn đạt cho khớp kết quả.

## Tuỳ chọn (biến môi trường cho `npm run server`)

- `CLAUDE_MODEL`: model cho CLI (mặc định là model đang đặt trong Claude Code)
- `CLAUDE_BIN`: đường dẫn tới lệnh `claude` nếu không có trong PATH
- `USE_API_KEY=1`: để CLI dùng `ANTHROPIC_API_KEY` thay cho phiên đăng nhập (mặc định server bỏ biến này đi vì nó được ưu tiên hơn login)

## Cấu trúc

- `src/components/` — scene 3D (`Office`, `Agent`, `StickFigure`) và HUD
- `src/sim/workflow.ts` — kịch bản công việc và standup
- `src/sim/ai.ts` — gọi server, nhận tin nhắn sếp ↔ agent, fallback khi lỗi
- `server/index.ts` — gọi Claude CLI, đọc `agents/*.md`, theo dõi `office/inbox.md`
