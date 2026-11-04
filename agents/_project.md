---
auto_push: true
mô_tả: Dự án thật mà agent làm việc. Khi sếp giao dự án mới, PM Sakura sẽ tự khởi tạo folder trong projects/ và tự điền vào đây.
path: projects/app-du-an
base_branch: main
code_model: sonnet
---

# Dự án thật

Khi `path` có giá trị và server đang chạy, các bước công việc là việc thật trên thư mục đó:

| Bước | Ai | Làm gì | Quyền |
|---|---|---|---|
| Code / sửa | Dev (BE, FE) | Viết code, chạy build/test | Đọc, sửa file, chạy lệnh trong danh sách cho phép |
| Review | QA | Đọc diff của branch so với `base_branch`, kết luận đạt / cần sửa | Chỉ đọc (kể cả `git diff/log/show`) |
| Test | Tester | Chạy test có sẵn hoặc viết test rồi chạy, kết luận pass / có bug | Đọc, sửa file test, chạy lệnh |
| Việc riêng | Người được giao | Làm theo yêu cầu | Theo vai trò như trên (PM: đọc và viết tài liệu) |

- Mỗi việc một branch `task/<mã>`. Server tự commit sau mỗi bước có thay đổi (tác giả là agent làm bước đó), và merge vào `base_branch` khi việc chung qua test hoặc việc riêng làm xong. Không bao giờ push.
- Lệnh được chạy: `npm`, `npx`, `node`, `pnpm`, `yarn`, `python`, `pip`, `pytest`, `tsc`, `git status/diff/log/show`, `ls`, `cat`, `mkdir`. Lệnh khác bị từ chối.
- Việc thật luôn chạy bằng Claude Code CLI (kể cả với agent đang dùng `cli: antigravity` để trò chuyện), vì chỉ Claude CLI giới hạn được từng công cụ.
- Mỗi agent có một session làm việc riêng trong thư mục dự án (khác session trò chuyện), nhớ những gì mình đã làm qua các việc.
- `code_model`: model cho việc thật (trống = model `work` trong `_models.md`).
- Xoá giá trị `path` để quay về chế độ mô phỏng.
