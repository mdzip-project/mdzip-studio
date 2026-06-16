!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "x64.nsh"

!define MDZIP_CLSID "{CA7A244F-7A83-4B5E-9D7A-9F13EF5E8B3A}"
!define MDZIP_PREVIEW_IID "{8895b1c6-b41f-4c1c-a562-0D564250836F}"
!define MDZIP_PROGID "MDZip.Studio.Document"
; Separate ProgID for .md so plain Markdown does NOT inherit the .mdz preview handler.
!define MDZIP_MD_PROGID "MDZip.Studio.Markdown"
!define MDZIP_CAPABILITIES "Software\MDZip Studio\Capabilities"
!define MDZIP_RUNTIME_URL "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe"

!ifndef BUILD_UNINSTALLER
Var ExplorerIntegrationCheckbox
Var InstallExplorerIntegration
Var MakeMdDefaultCheckbox
Var MakeMdDefault

Function CustomizeInstallScopePage
  FindWindow $0 "#32770" "" $HWNDPARENT

  FindWindow $1 "Static" "$(selectUserMode)" $0
  SendMessage $1 ${WM_SETTEXT} 0 \
    "STR:Explorer integration is available only with an all-users installation."

  FindWindow $1 "Button" "$(forAll)" $0
  SendMessage $1 ${WM_SETTEXT} 0 \
    "STR:All users (enables optional Explorer integration)"

  FindWindow $2 "Button" "" $0 $1
  ${If} $2 != 0
    SendMessage $2 ${WM_SETTEXT} 0 \
      "STR:Just me (application only)"
  ${EndIf}
FunctionEnd

!define MUI_PAGE_CUSTOMFUNCTION_SHOW CustomizeInstallScopePage

Function EnsureDotNetDesktopRuntime
  IfFileExists "$PROGRAMFILES64\dotnet\shared\Microsoft.WindowsDesktop.App\8.*\WindowsBase.dll" runtime_ready

  DetailPrint "Downloading the Microsoft .NET 8 Desktop Runtime..."
  nsExec::ExecToLog \
    '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$ProgressPreference = $\'SilentlyContinue$\'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $\'${MDZIP_RUNTIME_URL}$\' -OutFile $\'$PLUGINSDIR\windowsdesktop-runtime.exe$\'"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK \
      "MDZip Studio could not download the Microsoft .NET 8 Desktop Runtime.$\r$\n$\r$\nDownload result: $0"
    Abort
  ${EndIf}

  DetailPrint "Installing the Microsoft .NET 8 Desktop Runtime..."
  ExecWait '"$PLUGINSDIR\windowsdesktop-runtime.exe" /install /quiet /norestart' $0
  ${If} $0 != 0
  ${AndIf} $0 != 3010
    MessageBox MB_ICONSTOP|MB_OK \
      "The Microsoft .NET 8 Desktop Runtime installer failed with exit code $0."
    Abort
  ${EndIf}

runtime_ready:
FunctionEnd

!macro customInit
  StrCpy $InstallExplorerIntegration "0"
  StrCpy $MakeMdDefault "0"
  ${GetParameters} $R0
  ${GetOptions} $R0 "/mdzipExplorerIntegration" $R1
  ${IfNot} ${Errors}
    StrCpy $InstallExplorerIntegration "1"
  ${EndIf}
  ${GetOptions} $R0 "/mdzipMakeMdDefault" $R1
  ${IfNot} ${Errors}
    StrCpy $MakeMdDefault "1"
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Function ExplorerIntegrationPageCreate
    ${If} $installMode != "all"
      Abort
    ${EndIf}

    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 0x000C 0 "STR:Windows Explorer integration"
    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 0x000C 0 "STR:Choose optional integration for the all-users installation."

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 28u \
      "Choose whether MDZip Studio should integrate with Windows Explorer."
    Pop $0

    ${NSD_CreateCheckbox} 0 38u 100% 14u \
      "Install Windows Explorer integration"
    Pop $ExplorerIntegrationCheckbox

    ${NSD_CreateLabel} 14u 58u 94% 24u \
      "Adds .mdz and .md file registration and Explorer previews. Installs the Microsoft .NET 8 Desktop Runtime if needed."
    Pop $0

    ${NSD_CreateCheckbox} 0 88u 100% 14u \
      "Make MDZip Studio the default editor for .md files"
    Pop $MakeMdDefaultCheckbox

    ${NSD_CreateLabel} 14u 104u 94% 28u \
      "Optional. Windows protects an existing .md default, so this applies only when .md has no current default; otherwise confirm via Open with > Always or Settings > Default apps."
    Pop $0

    ; Explorer integration is the recommended default for all-users installs.
    StrCpy $InstallExplorerIntegration "1"
    ${NSD_Check} $ExplorerIntegrationCheckbox

    ; Changing the .md default is opt-in (left unchecked by default).
    StrCpy $MakeMdDefault "0"

    nsDialogs::Show
  FunctionEnd

  Function ExplorerIntegrationPageLeave
    ${NSD_GetState} $ExplorerIntegrationCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $InstallExplorerIntegration "1"
    ${Else}
      StrCpy $InstallExplorerIntegration "0"
    ${EndIf}

    ${NSD_GetState} $MakeMdDefaultCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $MakeMdDefault "1"
    ${Else}
      StrCpy $MakeMdDefault "0"
    ${EndIf}
  FunctionEnd

  Page custom ExplorerIntegrationPageCreate ExplorerIntegrationPageLeave
!macroend
!endif

!macro customInstall
  SetRegView 64

  ${If} $installMode == "all"
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayName \
      "MDZip Studio (All Users)"
  ${Else}
    WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" DisplayName \
      "MDZip Studio (Current User)"
  ${EndIf}

  ${If} $InstallExplorerIntegration == "1"
  ${AndIf} $installMode == "all"
    Call EnsureDotNetDesktopRuntime

    ; Release any loaded preview-handler binaries before an upgrade replaces them.
    nsExec::ExecToLog 'taskkill /F /IM prevhost.exe'

    WriteRegStr HKLM "Software\Classes\CLSID\${MDZIP_CLSID}" "" "MDZip Preview Handler"
    WriteRegStr HKLM "Software\Classes\CLSID\${MDZIP_CLSID}" "AppID" "${MDZIP_CLSID}"
    WriteRegDWORD HKLM "Software\Classes\CLSID\${MDZIP_CLSID}" "DisableLowILProcessIsolation" 1
    WriteRegStr HKLM "Software\Classes\CLSID\${MDZIP_CLSID}\InprocServer32" "" \
      "$INSTDIR\resources\preview-handler\mdz.WinPrev.comhost.dll"
    WriteRegStr HKLM "Software\Classes\CLSID\${MDZIP_CLSID}\InprocServer32" "ThreadingModel" "Apartment"

    WriteRegStr HKLM "Software\Classes\AppID\${MDZIP_CLSID}" "" "MDZip Preview Handler"
    WriteRegStr HKLM "Software\Classes\AppID\${MDZIP_CLSID}" "DllSurrogate" "Prevhost.exe"

    WriteRegStr HKLM "Software\Classes\.mdz\ShellEx\${MDZIP_PREVIEW_IID}" "" "${MDZIP_CLSID}"
    WriteRegStr HKLM "Software\Classes\.mdz\OpenWithProgids" "${MDZIP_PROGID}" ""

    WriteRegStr HKLM "Software\Classes\${MDZIP_PROGID}" "" "MDZip Document"
    WriteRegStr HKLM "Software\Classes\${MDZIP_PROGID}\DefaultIcon" "" \
      "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
    WriteRegStr HKLM "Software\Classes\${MDZIP_PROGID}\ShellEx\${MDZIP_PREVIEW_IID}" "" "${MDZIP_CLSID}"
    WriteRegStr HKLM "Software\Classes\${MDZIP_PROGID}\shell\open\command" "" \
      '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'

    ; Dedicated .md ProgID: open command + icon only, no .mdz preview handler.
    WriteRegStr HKLM "Software\Classes\${MDZIP_MD_PROGID}" "" "Markdown Document"
    WriteRegStr HKLM "Software\Classes\${MDZIP_MD_PROGID}\DefaultIcon" "" \
      "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
    WriteRegStr HKLM "Software\Classes\${MDZIP_MD_PROGID}\shell\open\command" "" \
      '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'

    ; List Studio as a candidate for .md (no default hijack): it appears under
    ; "Open with" and can be chosen as the default via Settings > Default apps.
    WriteRegStr HKLM "Software\Classes\.md\OpenWithProgids" "${MDZIP_MD_PROGID}" ""

    WriteRegStr HKLM "${MDZIP_CAPABILITIES}" "ApplicationName" "MDZip Studio"
    WriteRegStr HKLM "${MDZIP_CAPABILITIES}" "ApplicationDescription" \
      "Create, edit, validate, and preview MDZip documents."
    WriteRegStr HKLM "${MDZIP_CAPABILITIES}\FileAssociations" ".mdz" "${MDZIP_PROGID}"
    WriteRegStr HKLM "${MDZIP_CAPABILITIES}\FileAssociations" ".md" "${MDZIP_MD_PROGID}"
    WriteRegStr HKLM "Software\RegisteredApplications" "MDZip Studio" "${MDZIP_CAPABILITIES}"

    ${If} $MakeMdDefault == "1"
      ; Best-effort per-user default. Windows 10/11 protects an existing .md
      ; UserChoice, so this only takes effect when .md has no current default.
      ; In all-users (elevated) installs HKCU is the setup account's hive, so
      ; the end user may still need to confirm via Open with > Always.
      WriteRegStr HKCU "Software\Classes\.md" "" "${MDZIP_MD_PROGID}"
    ${EndIf}

    WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\PreviewHandlers" \
      "${MDZIP_CLSID}" "MDZip Preview Handler"
  ${EndIf}

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro RemoveExplorerIntegration
  ReadRegStr $0 HKLM "Software\Classes\.mdz\ShellEx\${MDZIP_PREVIEW_IID}" ""
  ${If} $0 == "${MDZIP_CLSID}"
    DeleteRegKey HKLM "Software\Classes\.mdz\ShellEx\${MDZIP_PREVIEW_IID}"
  ${EndIf}
  DeleteRegValue HKLM "Software\Classes\.mdz\OpenWithProgids" "${MDZIP_PROGID}"
  DeleteRegValue HKLM "Software\Classes\.md\OpenWithProgids" "${MDZIP_MD_PROGID}"

  ; Drop the .md default only if it still points at Studio (don't clobber a
  ; choice the user later made for another editor). The Capabilities key, and
  ; its .md/.mdz FileAssociations values, are removed with the key below.
  ReadRegStr $0 HKCU "Software\Classes\.md" ""
  ${If} $0 == "${MDZIP_MD_PROGID}"
    DeleteRegValue HKCU "Software\Classes\.md" ""
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Classes\${MDZIP_MD_PROGID}\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
    DeleteRegKey HKLM "Software\Classes\${MDZIP_MD_PROGID}"
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Classes\${MDZIP_PROGID}\shell\open\command" ""
  ${If} $0 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" $\"%1$\"'
    DeleteRegKey HKLM "Software\Classes\${MDZIP_PROGID}"
  ${EndIf}

  ReadRegStr $0 HKLM "Software\RegisteredApplications" "MDZip Studio"
  ${If} $0 == "${MDZIP_CAPABILITIES}"
    DeleteRegValue HKLM "Software\RegisteredApplications" "MDZip Studio"
  ${EndIf}
  DeleteRegKey HKLM "${MDZIP_CAPABILITIES}"

  ReadRegStr $0 HKLM "Software\Microsoft\Windows\CurrentVersion\PreviewHandlers" "${MDZIP_CLSID}"
  ${If} $0 == "MDZip Preview Handler"
    DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\PreviewHandlers" "${MDZIP_CLSID}"
  ${EndIf}

  ReadRegStr $0 HKLM "Software\Classes\CLSID\${MDZIP_CLSID}\InprocServer32" ""
  ${If} $0 == "$INSTDIR\resources\preview-handler\mdz.WinPrev.comhost.dll"
    DeleteRegKey HKLM "Software\Classes\CLSID\${MDZIP_CLSID}"
    DeleteRegKey HKLM "Software\Classes\AppID\${MDZIP_CLSID}"
  ${EndIf}
!macroend

!macro customUnInstall
  SetRegView 64
  nsExec::ExecToLog 'taskkill /F /IM prevhost.exe'
  !insertmacro RemoveExplorerIntegration

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
