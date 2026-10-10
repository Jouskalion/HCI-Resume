# 文件提取测试样本

本目录文件只用于自动化软件测试，姓名、学校、公司、经历和成绩均为虚构，不代表真实用户。

- `resume-zh.txt`、`resume-zh.docx`、`resume-zh.pdf`：包含相同内容的中文简历，用于检验三种文件入口。
- `no-text.pdf`：没有文本层，检验无法识别时的错误反馈。
- `encrypted.pdf`：加密 PDF，检验密码保护错误；测试密码仅用于虚构样本。

DOCX 由最小 OOXML 文档生成；PDF 测试使用标准 CID 字体声明，不包含操作系统字体文件。测试无需安装 Python 或 Office。
