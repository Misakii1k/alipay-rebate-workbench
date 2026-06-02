!macro customInit
  SetSilent normal
!macroend

# 自定义安装页面文本和样式
!macro customInstall
  # 设置安装页面的欢迎文本
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装电商运营工具箱"
  !define MUI_WELCOMEPAGE_TEXT "这是一款专为电商运营人员打造的效率工具，集成了支付宝返款、视频批量剪辑、收评助手、标题词优化等多个实用功能。$\r$\n$\r$\n点击「下一步」继续安装。"

  # 设置完成页面文本
  !define MUI_FINISHPAGE_TITLE "安装完成"
  !define MUI_FINISHPAGE_TEXT "电商运营工具箱已成功安装到您的计算机。$\r$\n$\r$\n点击「完成」关闭此向导。"
  !define MUI_FINISHPAGE_RUN_TEXT "立即启动电商运营工具箱"

  # 设置许可协议页面文本
  !define MUI_LICENSEPAGE_TEXT_TOP "请仔细阅读以下许可协议。"
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "如果您接受协议中的条款，请点击「我接受」继续安装。"
  !define MUI_LICENSEPAGE_BUTTON "我接受(&A)"

  # 设置目录选择页面文本
  !define MUI_DIRECTORYPAGE_TEXT_TOP "安装程序将把电商运营工具箱安装到以下文件夹。$\r$\n$\r$\n如需安装到不同文件夹，请点击「浏览」并选择其他文件夹。"
  !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "目标文件夹"

  # 设置安装进度页面文本
  !define MUI_INSTFILESPAGE_FINISHHEADER_TEXT "安装完成"
  !define MUI_INSTFILESPAGE_FINISHHEADER_SUBTEXT "安装已成功完成。"
  !define MUI_INSTFILESPAGE_ABORTHEADER_TEXT "安装已中止"
  !define MUI_INSTFILESPAGE_ABORTHEADER_SUBTEXT "安装未完成。"
!macroend

# 自定义卸载页面文本
!macro customUnInstall
  !define MUI_UNCONFIRMPAGE_TEXT_TOP "安装程序将从以下文件夹卸载电商运营工具箱。"
  !define MUI_UNINSTFILESPAGE_FINISHHEADER_TEXT "卸载完成"
  !define MUI_UNINSTFILESPAGE_FINISHHEADER_SUBTEXT "卸载已成功完成。"
!macroend
