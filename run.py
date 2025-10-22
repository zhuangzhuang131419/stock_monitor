import time
from datetime import datetime
import pytz
import subprocess
import configparser
import os
import sys
from typing import Union

# ==============================================================================
# 1. 配置
# ==============================================================================
SCHEDULED_HOUR = 17
TIMEZONE = pytz.timezone('America/New_York')
CONFIG_FILE = 'config.ini'


# ==============================================================================
# 2. 辅助函数
# ==============================================================================
def get_filenames_from_config() -> Union[tuple[str, str], None]:
    if not os.path.exists(CONFIG_FILE):
        print(f"错误: 配置文件 '{CONFIG_FILE}' 未找到。")
        return None
    config = configparser.ConfigParser()
    config.read(CONFIG_FILE)
    try:
        history_file = config.get('General', 'history_file')
        plot_file = config.get('General', 'plot_file')
        return history_file, plot_file
    except (configparser.NoSectionError, configparser.NoOptionError) as e:
        print(f"错误: 配置文件 '{CONFIG_FILE}' 格式不正确或缺少必要项: {e}")
        return None


def run_command(command: list[str]):
    try:
        print(f"  > 正在执行: {' '.join(command)}")
        result = subprocess.run(command, check=True, capture_output=True, text=True,
                                cwd=os.path.dirname(os.path.abspath(__file__)))
        if result.stdout:
            print(f"    [成功]\n{result.stdout.strip()}")
        # Git commit 可能会在没有变更时输出到 stderr，但返回码是0，所以也认为是成功
        if result.stderr and "nothing to commit" in result.stderr:
            print(f"    [提示]\n{result.stderr.strip()}")
        return True
    except FileNotFoundError:
        print(f"    [错误] 命令未找到: {command[0]}。请确保 Git 已安装并在系统的 PATH 中。")
        return False
    except subprocess.CalledProcessError as e:
        # 特殊处理 git commit 返回码为 1 且提示 "nothing to commit" 的情况
        if e.returncode == 1 and ("nothing to commit" in e.stdout or "nothing to commit" in e.stderr):
            print(f"    [提示] 没有文件变更需要提交。")
            return True  # 这种情况我们认为是成功，继续执行 push
        print(f"    [错误] 命令执行失败，返回码: {e.returncode}")
        if e.stderr:
            print(f"    [Stderr]:\n{e.stderr.strip()}")
        if e.stdout:
            print(f"    [Stdout]:\n{e.stdout.strip()}")
        return False


# ==============================================================================
# 3. 核心任务逻辑
# ==============================================================================
def run_scheduled_task():
    print("\n" + "=" * 50)
    print(f"触发任务 @ {datetime.now(TIMEZONE).strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print("=" * 50)

    # --- 第1步: 运行 main.py 脚本 ---
    print("\n[阶段 1/3] 正在运行 main.py 以更新数据和图表...")
    if not run_command([sys.executable, 'main.py']):
        print("\nmain.py 执行失败。任务中止。")
        return
    print("[阶段 1/3] main.py 执行完成。")

    # --- 第2步: 将所有变更添加到 Git ---
    print("\n[阶段 2/3] 正在将所有文件变更提交到 Git 仓库...")

    # <--- 修改在这里：使用 'git add .' 来添加所有变更 --->
    if not run_command(['git', 'add', '.']):
        print("Git add 失败。任务中止。")
        return

    commit_message = f"Automated portfolio update for {datetime.now(TIMEZONE).strftime('%Y-%m-%d')}"
    if not run_command(['git', 'commit', '-m', commit_message]):
        # 注意：run_command 内部已经处理了 "nothing to commit" 的情况
        print("Git commit 失败。")
        # 即使 commit 失败（非 "nothing to commit"），也尝试 push，以防有历史提交未推送

    # --- 第3步: 推送到远程仓库 ---
    print("\n[阶段 3/3] 正在推送到远程仓库...")
    if not run_command(['git', 'push']):
        print("Git push 失败。请检查您的网络连接和 Git SSH 认证设置。")
        return

    print("\n任务成功完成！")


# ==============================================================================
# 4. 主服务循环
# ==============================================================================
if __name__ == "__main__":
    print("\n自动化服务已启动。")
    print(f"将在每天美东时间 {SCHEDULED_HOUR}:00 左右运行任务。")
    print("按 Ctrl+C 停止服务。")
    last_run_date = None
    run_scheduled_task()

    while True:
        try:
            now_et = datetime.now(TIMEZONE)
            if now_et.hour == SCHEDULED_HOUR and now_et.date() != last_run_date:
                run_scheduled_task()
                last_run_date = now_et.date()
                print(f"\n任务已执行。等待下一个调度周期...")
            time.sleep(60)
        except KeyboardInterrupt:
            print("\n服务已手动停止。")
            break
        except Exception as e:
            print(f"\n发生意外错误: {e}")
            print("服务将在60秒后继续...")
            time.sleep(60)
