[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

param(
    [string]$SecretValue = "https://internal.bank.com/api/v1",
    [string]$DefaultAlias = "`$BANK_API_URL",
    [string]$OutputFile = ""
)

Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Aegis Gate Security" Height="240" Width="460"
        WindowStartupLocation="CenterScreen" Topmost="True" ResizeMode="NoResize"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent">
    <Border Background="#18181B" CornerRadius="12" BorderBrush="#3F3F46" BorderThickness="1.5">
        <Border.Effect>
            <DropShadowEffect BlurRadius="30" ShadowDepth="4" Opacity="0.8" Color="#000000"/>
        </Border.Effect>
        <Grid Margin="22">
            <Grid.RowDefinitions>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="Auto"/>
                <RowDefinition Height="*"/>
            </Grid.RowDefinitions>

            <!-- Header -->
            <StackPanel Grid.Row="0" Orientation="Horizontal" Margin="0,0,0,12">
                <Border Background="#3B82F6" Width="10" Height="10" CornerRadius="5" VerticalAlignment="Center" Margin="0,0,10,0"/>
                <TextBlock Text="Обнаружен секретный адрес" Foreground="#F4F4F5" FontSize="14" FontWeight="Bold"/>
            </StackPanel>

            <!-- Detected Secret -->
            <Border Grid.Row="1" Background="#09090B" CornerRadius="6" Padding="10,8" Margin="0,0,0,14" BorderBrush="#27272A" BorderThickness="1">
                <TextBlock Text="$SecretValue" Foreground="#A1A1AA" FontSize="12" FontFamily="Consolas" TextTrimming="CharacterEllipsis"/>
            </Border>

            <!-- Input Box -->
            <Grid Grid.Row="2" Margin="0,0,0,16">
                <TextBox Name="AliasInput" Text="$DefaultAlias" Background="#27272A" Foreground="#60A5FA" 
                         BorderThickness="1" BorderBrush="#3B82F6" Padding="8,6" FontSize="13" 
                         FontFamily="Consolas" FontWeight="SemiBold"/>
            </Grid>

            <!-- Actions -->
            <Grid Grid.Row="3">
                <StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
                    <Button Name="SkipBtn" Content="Пропустить (Esc)" Background="Transparent" Foreground="#A1A1AA" 
                            BorderThickness="0" Padding="12,6" Cursor="Hand" Margin="0,0,10,0" FontSize="12"/>
                    <Button Name="SaveBtn" Content="Сохранить (Enter)" Background="#2563EB" Foreground="#FFFFFF" 
                            BorderThickness="0" Padding="16,6" FontWeight="SemiBold" Cursor="Hand" FontSize="12"/>
                </StackPanel>
            </Grid>
        </Grid>
    </Border>
</Window>
"@

$bytes = [System.Text.Encoding]::UTF8.GetBytes($xaml)
$stream = [System.IO.MemoryStream]::new($bytes)
$reader = [System.Xml.XmlReader]::Create($stream)
$window = [System.Windows.Markup.XamlReader]::Load($reader)

$inputBox = $window.FindName("AliasInput")
$saveBtn = $window.FindName("SaveBtn")
$skipBtn = $window.FindName("SkipBtn")

function Finish([string]$status, [string]$alias) {
    $result = @{
        status = $status
        alias = $alias
        secret = $SecretValue
    } | ConvertTo-Json -Compress

    if ($OutputFile -and (Test-Path -Path (Split-Path $OutputFile -Parent))) {
        [System.IO.File]::WriteAllText($OutputFile, $result, [System.Text.Encoding]::UTF8)
    } else {
        [System.Console]::WriteLine($result)
    }
    $window.Close()
}

$saveBtn.Add_Click({
    Finish "save" $inputBox.Text
})

$skipBtn.Add_Click({
    Finish "skip" ""
})

$window.Add_KeyDown({
    param($s, $e)
    if ($e.Key -eq "Enter") {
        Finish "save" $inputBox.Text
    } elseif ($e.Key -eq "Escape") {
        Finish "skip" ""
    }
})

$window.Add_Loaded({
    $inputBox.Focus()
    $inputBox.SelectAll()
})

$window.ShowDialog() | Out-Null
