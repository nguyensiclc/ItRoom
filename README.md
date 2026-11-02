# IT Room 3D

Phòng IT 3D với 5 agent người que, mỗi người một khoang ngồi: PM, Dev Backend (BE), Dev Frontend (FE), QA, Tester.

**Agent chỉ làm khi bạn giao việc**: bật **📋 Giao việc** trong cửa sổ 💬 Chat (xem [Chat kiểu Teams](#chat-kiểu-teams)), hoặc viết dòng `giao ...` vào `office/inbox.md`:

- Giao trong **Cả team** (hoặc `giao @team <việc>`): việc chung. Cả team ra bàn họp, PM đặt tên task và chọn BE / FE / FULLSTACK, mỗi người nêu phần của mình, PM chốt phân công. Sau đó dev làm (fullstack: BE làm API rồi bàn giao FE) → QA review → Tester test → PM báo cáo bạn. Bug được giao cho đúng người phụ trách phần bị lỗi.
- Giao trong chat riêng với một người (hoặc `giao @FE <việc>`, @PM, @BE, @QA, @Tester): việc riêng. Chỉ người đó nhận việc, làm, rồi báo cáo bạn.

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
| `agents/PM.md`, `BE.md`, `FE.md`, `QA.md`, `Tester.md` | Tính cách, sở thích, quan hệ đồng nghiệp, vai trò (phần đầu có tên, chức danh, `cli:`). Sửa file là có hiệu lực từ câu tiếp theo |
| `agents/PM_skills.md`, `BE_skills.md`... | Chuyên môn: bảng kỹ năng có mức sao ★, công cụ / tech stack, giới hạn. Server nối sau file tính cách khi gửi cho CLI; bảng chi tiết agent hiện mục "Chuyên môn" |
| `agents/_project.md` | Dự án thật: thư mục, branch chính, model để code |
| `office/inbox.md` | Hộp thư của bạn: thêm dòng `@FE nội dung` (hoặc `@all ...`) rồi lưu |
| `office/chat/BE-QA.md`, `FE-Tester.md`... | Trò chuyện riêng giữa từng cặp agent (tạo khi hai người nói chuyện lần đầu) |
| `office/chat/team.md` | Kênh chung: thông báo task mới, standup |
| `office/chat/Sep-<Role>.md` | Trò chuyện riêng giữa bạn và từng agent |
| `office/chat.md` | Nhật ký tổng để bạn theo dõi cả phòng (agent không đọc) |

Mỗi agent chỉ nhận tin của những kênh mình tham gia (cặp riêng của mình, kênh với sếp, kênh team), nên chuyện riêng giữa hai người không lộ sang người khác.

## Dự án thật

Cấu hình ở `agents/_project.md` (mặc định `path: D:Projectsmy-app`). Khi có `path` và server đang chạy, các bước công việc là việc thật trên thư mục đó; server tự tạo thư mục và repo git (commit đầu trên `main`) nếu chưa có.

- **Dev (BE, FE)** viết code thật, chạy build/test. **QA** đọc diff thật của branch rồi kết luận đạt / cần sửa. **Tester** chạy test thật (hoặc viết test rồi chạy) và báo bug kèm phần gây lỗi. Việc riêng thì người được giao làm thật theo vai trò.
- Không còn tung xúc xắc: review fail / có bug là do QA, Tester kết luận. Góp ý và mô tả bug được chuyển nguyên cho dev sửa.
- Mỗi việc một branch `task/<mã>`. Server commit sau mỗi bước có thay đổi (tác giả là agent làm bước đó), merge vào `main` khi việc chung qua test hoặc việc riêng xong. Không bao giờ push.
- Quyền: dev và tester sửa file và chạy lệnh trong danh sách cho phép (npm, npx, node, pnpm, yarn, python, pip, pytest, tsc, git status/diff/log/show, ls, cat, mkdir); QA chỉ đọc; PM đọc và viết tài liệu. Lệnh khác bị từ chối.
- Việc thật luôn chạy bằng Claude Code CLI, kể cả Lan và Tú (agy không giới hạn được từng công cụ); trò chuyện của họ vẫn dùng agy. Mỗi agent có session làm việc riêng trong thư mục dự án.
- Mỗi bước có thể mất vài phút (tối đa 25 phút), trong lúc đó agent hiện bong bóng "⌨️ Đang code thật...", "🔍 Đang review diff..."... Bước nào lỗi (CLI lỗi, quá giờ) thì bước đó quay về mô phỏng.
- Nhật ký từng bước (branch, commit, đã merge chưa, số giây) ghi trong `office/chat.md`.
- Biến môi trường `PROJECT_DIR` thay cho `path`. Xoá `path` để quay về mô phỏng.

## Chat kiểu Teams

Nút **💬 Chat** trên thanh trên cùng mở cửa sổ chat (số đỏ là tin chưa xem). Đây là chỗ nhắn tin và giao việc duy nhất trên giao diện:

- **Cả team**: kênh chung (`office/chat/team.md`), có cả các câu họp và standup của team. Nhắn ở đây thì cả 5 người lần lượt trả lời, hoặc chỉ người được @gọi tên.
- **📋 Giao việc**: nút bên trái ô nhập. Bật lên rồi gửi: trong **Cả team** là việc chung (cả team họp rồi làm), trong chat riêng là việc riêng của người đó. Tin giao việc có nền vàng và nhãn "📋 Giao việc"; câu nhận việc và báo cáo của agent hiện trong chat riêng (việc chung do PM báo cáo).
- **Trò chuyện riêng**: nhắn với từng người. Dùng chung file `office/chat/Sep-<Role>.md` với tin nhắn qua `inbox.md`, nên lịch sử cũ vẫn hiện. Bảng chi tiết agent có nút "💬 Nhắn" mở thẳng cuộc chat này.
- **Nhóm**: "＋ Nhóm mới", đặt tên, chọn bất kỳ agent nào. Nút "👥 Thành viên" để đổi tên, thêm hoặc bớt người. Thêm hoặc bớt người thì nhóm có dòng thông báo, người mới vào đọc được các tin gần nhất.
  - Không gọi tên ai thì cả nhóm lần lượt trả lời, người sau đọc được câu người trước.
  - Gõ `@Khoa` hoặc `@FE` (hoặc bấm nút "Gọi riêng") thì chỉ người được gọi trả lời.
- Đang có người soạn trả lời thì hiện "... đang soạn tin"; người que trong phòng cũng hiện bong bóng trả lời.
- Danh sách nhóm nằm ở `office/groups.json`, tin nhắn ở `office/chat/Nhom-<id>.md`. Xoá nhóm chỉ bỏ nhóm khỏi danh sách, file tin nhắn vẫn giữ.
- Mỗi tin của sếp, mỗi người trả lời là một lượt CLI (loại việc `boss`), nên nhóm đông thì chờ lâu hơn và tốn hơn.

## Xem chi tiết agent

Bấm vào người que để mở bảng chi tiết (nút "💬 Nhắn" mở chat riêng với người đó):

- Trạng thái, task đang giữ, sở thích, số việc đã xong.
- CLI đang dùng (Claude Code / Antigravity, tiến trình agy có đang chạy liên tục không), số lượt và lệnh mở session.
- Model cho từng loại việc.
- Tính cách từ `agents/<Role>.md`.

Phần CLI và model lấy từ `GET /api/agent?role=BE`, tự làm mới mỗi 4 giây; không chạy server thì chỉ hiện phần trạng thái.

## Lúc rảnh

Agent không giữ task nào thì ngồi chơi theo sở thích: Lan đọc sách 📖, Minh chơi game 🎮, Khoa nghe nhạc 🎧, Hà xem phim 🍿, Tú xoay rubik 🧩. Thỉnh thoảng một người rảnh sang khoang người rảnh khác tán gẫu (3 câu, ghi vào file riêng của hai người). Lẩm bẩm về sở thích chỉ là câu có sẵn, không gọi Claude.

Vẫn có thể nhắn và giao việc bằng cách viết tay vào `office/inbox.md` (`@FE ...`, `giao @team ...`, `reset @BE`); tin nhắn đó hiện trong cửa sổ chat như tin gửi từ giao diện.

Khi chưa cấu hình dự án thật, kết quả đạt / có lỗi trong quy trình do mô phỏng tung xúc xắc để giữ nhịp; Claude diễn đạt cho khớp kết quả.

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
