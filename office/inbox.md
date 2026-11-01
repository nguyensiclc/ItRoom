# Hộp thư gửi agent

Agent chỉ làm việc khi bạn giao. Chưa giao thì cả team ngồi chơi theo sở thích.
Mỗi dòng là một lệnh, viết xong thì lưu file.

## Giao việc

- `giao @team <việc>`: **việc chung**. Cả team ra bàn họp, PM chốt phân công, rồi BE/FE làm → QA review → Tester test → PM báo cáo bạn.
- `giao @PM`, `giao @BE`, `giao @FE`, `giao @QA`, `giao @Tester <việc>`: **việc riêng**. Chỉ người đó làm, xong báo cáo bạn.

Ví dụ:
- `giao @team làm tính năng mã giảm giá khi thanh toán`
- `giao @FE sửa nút Mua ngay bị lệch trên điện thoại`

Việc được làm lần lượt theo thứ tự giao. Việc chờ đến lượt nằm ở cột "Cần làm" trên giao diện.

## Nhắn tin (không giao việc)

- `@PM`, `@BE`, `@FE`, `@QA`, `@Tester <tin nhắn>`: nhắn riêng một người
- `@all <tin nhắn>`: cả team trả lời lần lượt

Server đánh dấu ✅ vào dòng đã xử lý. Câu trả lời hiện trên đầu agent trong phòng 3D và được ghi vào `office/chat/Sep-<Role>.md` (việc chung ghi vào `office/chat/team.md`).

---

✅ @QA bạn thấy chất lượng code tuần này thế nào?
✅ @Dev Bạn đang làm gì thế
✅ @QA bạn thấy chất lượng code tuần này thế nào?
✅ @Dev Hôm nay team ưu tiên việc gì?
✅ giao @FE sửa nút Mua ngay bị lệch trên điện thoại
✅ giao @FE sửa nút Mua ngay bị lệch trên điện thoại
✅ giao @team Làm tính năng mã giảm giá khi thanh toán
✅ giao @team làm tính năng mã giảm giá khi thanh toán
✅ giao @QA test thử
✅ giao @team làm tính năng mã giảm giá khi thanh toán
✅ giao @team thêm nút đăng nhập bằng Google
