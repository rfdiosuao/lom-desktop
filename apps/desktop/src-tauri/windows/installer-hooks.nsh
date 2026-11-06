; INSTALL-PATH-01：Windows 安装目录只用英文，界面显示名仍是「麓鸣 Lom」。
;
; 产品名（开始菜单快捷方式名、卸载项名称、注册表键）保持「麓鸣 Lom」不变，
; 只把安装目录的最后一级从「麓鸣 Lom」换成「Lom」，例如：
;   %LOCALAPPDATA%\麓鸣 Lom  ->  %LOCALAPPDATA%\Lom
; 已经装在旧目录的用户（含自动更新）：新文件装进新目录后，把指向旧程序的快捷方式
; 改指新程序，再删掉旧目录里本产品自己的文件；用户数据在 %APPDATA%\top.heang.lom，
; 钥匙串按 top.heang.lom 存取，都与安装目录无关，不做任何改动。
;
; 本文件在模板定义产品名之前被包含：顶层只能用这里自己的定义，
; 产品名、主程序名等模板定义只能写在钩子宏里（宏在插入处才展开）。

!include LogicLib.nsh
!include FileFunc.nsh

!define LOM_LEGACY_DIR_NAME "麓鸣 Lom"
!define LOM_ASCII_DIR_NAME "Lom"

Var LomRequestedDir
Var LomPreviousDir
Var LomDirLeaf
Var LomDirParent

; 安装目录最后一级是旧中文名时换成英文名；其它目录（包括用户自选的英文目录）原样保留
!macro LomUseAsciiInstallDir
  ${GetFileName} "$INSTDIR" $LomDirLeaf
  ${If} $LomDirLeaf == "${LOM_LEGACY_DIR_NAME}"
    ${GetParent} "$INSTDIR" $LomDirParent
    StrCpy $INSTDIR "$LomDirParent\${LOM_ASCII_DIR_NAME}"
  ${EndIf}
!macroend

; 界面安装：目录页出现之前就换成英文目录，用户看到的就是实际安装位置
!define MUI_CUSTOMFUNCTION_GUIINIT LomGuiInit
Function LomGuiInit
  !insertmacro LomUseAsciiInstallDir
FunctionEnd

; 旧位置其实就是这次的目录时（大小写、短文件名、末尾斜杠或目录链接不同）放弃迁移：
; 在新目录写一个标记文件，再看旧位置能不能看到它，不靠路径字符串比较
!define LOM_SAME_DIR_MARKER ".lom-install-path-01.tmp"
!macro LomForgetIfSameDir
  ${If} $LomPreviousDir != ""
    FileOpen $0 "$INSTDIR\${LOM_SAME_DIR_MARKER}" w
    FileClose $0
    ${If} ${FileExists} "$LomPreviousDir\${LOM_SAME_DIR_MARKER}"
      StrCpy $LomPreviousDir ""
    ${EndIf}
    Delete "$INSTDIR\${LOM_SAME_DIR_MARKER}"
  ${EndIf}
!macroend

; 快捷方式仍指向旧目录的主程序时，在原位置重建并指向新目录（同时更新“起始位置”）
!macro LomRepointShortcut shortcut
  ${If} ${FileExists} "${shortcut}"
    !insertmacro IsShortcutTarget "${shortcut}" "$LomPreviousDir\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      SetOutPath "$INSTDIR"
      CreateShortcut "${shortcut}" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "${shortcut}"
      DetailPrint "INSTALL-PATH-01: shortcut moved to $INSTDIR"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; 模板在本节稍后才把新目录写进注册表，此刻读到的是上一次安装的位置
  ReadRegStr $LomPreviousDir SHCTX "${MANUPRODUCTKEY}" ""
  StrCpy $LomRequestedDir "$INSTDIR"
  ; 静默安装不经过界面初始化，这里再换一次；界面安装时已是英文目录，不会重复变化
  !insertmacro LomUseAsciiInstallDir
  ${If} $INSTDIR != $LomRequestedDir
    SetOutPath "$INSTDIR"
    ; 模板开头的 SetOutPath 可能刚建出空的旧目录；非空时这一步什么也不删
    RMDir "$LomRequestedDir"
  ${EndIf}
  ; 注册表没有记录时，以模板原本要装的目录作为旧安装位置
  ${If} $LomPreviousDir == ""
    StrCpy $LomPreviousDir "$LomRequestedDir"
  ${EndIf}
  ; 只有旧位置确实装着本产品、且不是这次的目录时才迁移
  ${If} $LomPreviousDir == $INSTDIR
  ${OrIfNot} ${FileExists} "$LomPreviousDir\${MAINBINARYNAME}.exe"
    StrCpy $LomPreviousDir ""
  ${EndIf}
  !insertmacro LomForgetIfSameDir
  ${If} $LomPreviousDir != ""
    DetailPrint "INSTALL-PATH-01: moving install from $LomPreviousDir to $INSTDIR"
    ; 旧目录里的程序和核心还在运行时，先按模板同样的方式提示或结束它们
    !insertmacro CheckIfAppIsRunning "$LomPreviousDir\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    !insertmacro CheckIfAppIsRunning "$LomPreviousDir\aioncore.exe" "${PRODUCTNAME}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; 新程序、卸载项和注册表都已写好之后才动旧目录：中途失败时旧安装仍然可用。
  ; 删除前再确认一次旧位置不是新目录，绝不删到刚装好的文件
  !insertmacro LomForgetIfSameDir
  ${If} $LomPreviousDir != ""
    !insertmacro LomRepointShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    !insertmacro LomRepointShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
    !insertmacro LomRepointShortcut "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\${PRODUCTNAME}.lnk"
    ; 只删本产品安装过的文件，不递归删除目录：用户自己放进去的文件原样保留
    Delete "$LomPreviousDir\${MAINBINARYNAME}.exe"
    Delete "$LomPreviousDir\aioncore.exe"
    Delete "$LomPreviousDir\lark-cli.exe"
    Delete "$LomPreviousDir\licenses\lark-cli-LICENSE"
    Delete "$LomPreviousDir\licenses\personal-templates-NOTICE"
    RMDir "$LomPreviousDir\licenses"
    Delete "$LomPreviousDir\uninstall.exe"
    RMDir "$LomPreviousDir"
    ${If} ${FileExists} "$LomPreviousDir\${MAINBINARYNAME}.exe"
      DetailPrint "INSTALL-PATH-01: old program could not be removed from $LomPreviousDir"
    ${EndIf}
  ${EndIf}
!macroend
