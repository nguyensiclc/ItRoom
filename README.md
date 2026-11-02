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

Mỗi agent là **một session Claude Code CLI riêng**: lần nói đầu tiên server tạo session (`claude -p --session-id <id>`), các lần sau nối tiếp đúng session đó (`claude -p --resume <id>`). Vì vậy mỗi agent nhớ mọi thứ mình đã nghe và nói, kể cả sau khi tắt server. Dùng phiên đăng nhập Claude Code sẵn có trên máy (không cần API key). Không chạy server thì app dùng kịch bản có sẵn.

- `office/sessions.md`: session ID của từng agent. Muốn xem lại hoặc nói chuyện trực tiếp với một agent, mở terminal ở thư mục dự án và chạy `claude --resume <id>` (nên tắt server trước).
- Mỗi lượt nói, agent chỉ nhận các tin **mới chưa đọc** trong kênh đang nói, những gì cũ đã có sẵn trong session.
- Session dài dần thì mỗi câu tốn hơn. Thêm `reset @BE` hoặc `reset @all` vào `office/inbox.md` để bắt đầu lại.

### Model theo loại việc (`agents/_models.md`)

| Loại việc | Khi nào | Mặc định |
|---|---|---|
| `smalltalk` | Tán gẫu lúc rảnh | `haiku` (rẻ, nhanh) |
| `work` | Code, review, test, bàn giao, làm việc riêng | `sonnet` |
| `plan` | Họp việc chung và chốt phân công | `opus` |
| `boss` | Trả lời sếp, nhận việc riêng, báo cáo | `sonnet` |

Sửa phần đầu file là có hiệu lực từ câu tiếp theo. Đổi model giữa các lượt vẫn giữ nguyên trí nhớ của session. `office/chat.md` ghi kèm loại việc, CLI và model của từng câu.

### Antigravity CLI cho một số agent

Agent có dòng `cli: antigravity` ở đầu file persona thì nói bằng Antigravity CLI (`agy`) thay cho Claude Code. Hiện là **PM** (`agents/PM.md`) và **Tester** (`agents/Tester.md`); các agent khác ghi `cli: claude`.

- Model của agy đặt ở các khoá `agy_smalltalk`, `agy_work`, `agy_plan`, `agy_boss` trong `agents/_models.md` (xem danh sách bằng `agy models`).
- Mỗi agent agy cũng có hội thoại riêng (`agy --conversation <id>`), nhớ qua các lượt. Lệnh mở nằm trong `office/sessions.md`.
- agy chạy trong thư mục trống `office/agy-workspace` với `--sandbox`, để không đụng vào code dự án.
- **Tiến trình chạy liên tục:** khi bật server, mỗi agent agy có sẵn một tiến trình `agy --input-format stream-json` chạy ngầm, nối vào đúng hội thoại của mình. Mỗi câu chỉ ghi một dòng JSON vào tiến trình đó, khoảng 4–5 giây thay vì 10–15 giây khi bật agy mỗi câu.
  - Model gắn với tiến trình lúc khởi động. Câu cần model khác (vd họp dùng `agy_plan`) thì tiến trình khởi động lại với model đó trên cùng hội thoại (khoảng 8–10 giây), rồi tự chuyển về model `agy_work` ở chế độ nền sau 20 giây im lặng.
  - Tiến trình lỗi hoặc treo thì server quay về gọi agy từng lần, câu sau tự bật lại tiến trình. Tắt server thì các tiến trình agy tắt theo.
  - `office/chat.md` ghi kèm "chạy liên tục" hoặc "gọi từng lần" và số giây của từng câu.
- Cần đăng nhập Antigravity sẵn trên máy. Hội thoại agy to nhanh hơn claude (mỗi lượt gửi kèm prompt agent khoảng 10 nghìn token), nên tốn quota hơn; dùng `reset @PM` khi cần.
- Đổi `cli:` của một agent thì agent đó bắt đầu session mới.

## Các file .md

| File | Vai trò |
|---|---|
| `agents/_rules.md` | Luật chung cho mọi agent (cách nói, độ dài, định dạng) |
| `agents/_models.md` | Model Claude cho từng loại việc (tán gẫu dùng haiku...) |
| `agents/PM.md`, `BE.md`, `FE.md`, `QA.md`, `Tester.md` | Tính cách từng agent. Sửa file là có hiệu lực từ câu tiếp theo |
| `office/inbox.md` | Hộp thư của bạn: thêm dòng `@FE nội dung` (hoặc `@all ...`) rồi lưu |
| `office/chat/BE-QA.md`, `FE-Tester.md`... | Trò chuyện riêng giữa từng cặp agent (tạo khi hai người nói chuyện lần đầu) |
| `office/chat/team.md` | Kênh chung: thông báo task mới, standup |
| `office/chat/Sep-<Role>.md` | Trò chuyện riêng giữa bạn và từng agent |
| `office/chat.md` | Nhật ký tổng để bạn theo dõi cả phòng (agent không đọc) |

Mỗi agent chỉ nhận tin của những kênh mình tham gia (cặp riêng của mình, kênh với sếp, kênh team), nên chuyện riêng giữa hai người không lộ sang người khác.

## Lúc rảnh

Agent không giữ task nào thì ngồi chơi theo sở thích: Lan đọc sách 📖, Minh chơi game 🎮, Khoa nghe nhạc 🎧, Hà xem phim 🍿, Tú xoay rubik 🧩. Thỉnh thoảng một người rảnh sang khoang người rảnh khác tán gẫu (3 câu, ghi vào file riêng của hai người). Lẩm bẩm về sở thích chỉ là câu có sẵn, không gọi Claude.

Ô chat ở góc dưới bên trái giao diện cũng ghi vào `office/inbox.md`, nên tin nhắn từ giao diện hay viết tay vào file đều đi cùng một đường.

Kết quả đạt / có lỗi trong quy trình vẫn do mô phỏng tung xúc xắc để giữ nhịp; Claude diễn đạt cho khớp kết quả.

## Tuỳ chọn (biến môi trường cho `npm run server`)

- `CLAUDE_MODEL`: dùng một model cho mọi việc, bỏ qua `agents/_models.md`
- `CLAUDE_BIN`: đường dẫn tới lệnh `claude` nếu không có trong PATH
- `AGY_BIN`: đường dẫn tới lệnh `agy` (Antigravity CLI) nếu không có trong PATH
- `USE_API_KEY=1`: để CLI dùng `ANTHROPIC_API_KEY` thay cho phiên đăng nhập (mặc định server bỏ biến này đi vì nó được ưu tiên hơn login)

## Cấu trúc

- `src/components/` — scene 3D (`Office`, `Agent`, `StickFigure`) và HUD
- `src/sim/workflow.ts` — kịch bản công việc và standup
- `src/sim/ai.ts` — gọi server, nhận tin nhắn sếp ↔ agent, fallback khi lỗi
- `server/index.ts` — gọi Claude CLI, đọc `agents/*.md`, theo dõi `office/inbox.md`
