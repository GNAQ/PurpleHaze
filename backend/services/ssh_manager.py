"""
SSH 连接管理器：管理到远程机器的持久连接
"""
import asyncio
import io
import logging
import struct
import threading
from typing import Optional

import paramiko

from config import SSH_CONNECT_TIMEOUT, SSH_COMMAND_TIMEOUT

logger = logging.getLogger(__name__)


def _load_pkey(key_str: str) -> paramiko.PKey:
    """从 PEM 字符串解析私钥（支持 RSA / Ed25519 / ECDSA），失败抛 SSHException。"""
    for key_cls in (paramiko.RSAKey, paramiko.Ed25519Key, paramiko.ECDSAKey):
        try:
            return key_cls.from_private_key(io.StringIO(key_str))
        except (paramiko.SSHException, ValueError):
            continue
    raise paramiko.SSHException("无法解析私钥（支持 RSA / Ed25519 / ECDSA）")


class SSHConnection:
    """单条 SSH 连接的封装，支持 ProxyJump 跳板机"""

    def __init__(self, machine_id: int, host: str, port: int, username: str,
                 password: Optional[str] = None, private_key: Optional[str] = None,
                 # 跳板机参数
                 proxy_host: Optional[str] = None, proxy_port: int = 22,
                 proxy_username: Optional[str] = None,
                 proxy_password: Optional[str] = None,
                 proxy_private_key: Optional[str] = None,
                 auto_reconnect: bool = True):
        self.machine_id = machine_id
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.private_key_str = private_key
        # 跳板机
        self.proxy_host = proxy_host
        self.proxy_port = proxy_port
        self.proxy_username = proxy_username
        self.proxy_password = proxy_password
        self.proxy_private_key_str = proxy_private_key
        self.auto_reconnect = auto_reconnect

        self._client: Optional[paramiko.SSHClient] = None
        self._proxy_client: Optional[paramiko.SSHClient] = None
        self._lock = threading.Lock()
        self._connected = False
        self._last_error: Optional[str] = None

    @property
    def connected(self) -> bool:
        with self._lock:
            if not self._connected or self._client is None:
                return False
            transport = self._client.get_transport()
            return transport is not None and transport.is_active()

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    def connect(self) -> bool:
        """建立 SSH 连接，返回是否成功。若配置了跳板机，先连接跳板机再通过 direct-tcpip 隧道连接目标。"""
        with self._lock:
            try:
                # ── 1. 若有跳板机，先建立跳板机连接并打开隧道 ───────────────────────
                sock = None
                if self.proxy_host:
                    proxy_client = paramiko.SSHClient()
                    proxy_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    proxy_kwargs: dict = dict(
                        hostname=self.proxy_host,
                        port=self.proxy_port,
                        username=self.proxy_username,
                        timeout=SSH_CONNECT_TIMEOUT,
                        banner_timeout=60,
                        auth_timeout=SSH_CONNECT_TIMEOUT,
                        look_for_keys=False,
                        allow_agent=False,
                    )
                    if self.proxy_private_key_str:
                        proxy_kwargs["pkey"] = _load_pkey(self.proxy_private_key_str)
                    elif self.proxy_password:
                        proxy_kwargs["password"] = self.proxy_password
                    proxy_client.connect(**proxy_kwargs)
                    transport = proxy_client.get_transport()
                    sock = transport.open_channel(
                        "direct-tcpip",
                        (self.host, self.port),
                        ("", 0),
                    )
                    # 旧的跳板机客户端先关闭
                    if self._proxy_client:
                        try:
                            self._proxy_client.close()
                        except Exception:
                            pass
                    self._proxy_client = proxy_client
                    logger.info(f"[SSH] 已通过跳板机 {self.proxy_host} 建立隧道至 {self.host}:{self.port}")

                # ── 2. 连接目标主机 ────────────────────────────────────────────────
                client = paramiko.SSHClient()
                client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

                kwargs: dict = dict(
                    hostname=self.host,
                    port=self.port,
                    username=self.username,
                    timeout=SSH_CONNECT_TIMEOUT,
                    banner_timeout=60,
                    auth_timeout=SSH_CONNECT_TIMEOUT,
                    # 禁用 SSH Agent 和本地密钥文件扫描，避免意外认证行为
                    look_for_keys=False,
                    allow_agent=False,
                )
                if sock is not None:
                    kwargs["sock"] = sock
                if self.private_key_str:
                    kwargs["pkey"] = _load_pkey(self.private_key_str)
                elif self.password:
                    kwargs["password"] = self.password

                client.connect(**kwargs)
                self._client = client
                self._connected = True
                self._last_error = None
                logger.info(f"[SSH] 已连接到 {self.username}@{self.host}:{self.port}")
                return True
            except struct.error as e:
                # paramiko 4.x 在 SSH 握手层读取不到完整帧数据时抛出 struct.error
                # 常见原因：服务器端口非 SSH 服务、防火墙 RST、服务器 banner 超长
                self._connected = False
                self._last_error = f"SSH 协议握手失败（服务器响应不完整）：{e}"
                logger.warning(f"[SSH] 连接 {self.host} 失败（协议握手错误）: {e}")
                return False
            except paramiko.AuthenticationException as e:
                self._connected = False
                self._last_error = f"SSH 认证失败：{e}"
                logger.warning(f"[SSH] 连接 {self.host} 认证失败: {e}")
                return False
            except paramiko.SSHException as e:
                self._connected = False
                self._last_error = f"SSH 协议错误：{e}"
                logger.warning(f"[SSH] 连接 {self.host} SSH 协议错误: {e}")
                return False
            except Exception as e:
                self._connected = False
                self._last_error = str(e)
                logger.warning(f"[SSH] 连接 {self.host} 失败: {e}")
                return False

    def disconnect(self) -> None:
        with self._lock:
            if self._client:
                try:
                    self._client.close()
                except Exception:
                    pass
            self._client = None
            self._connected = False
            # 关闭跳板机连接
            if self._proxy_client:
                try:
                    self._proxy_client.close()
                except Exception:
                    pass
            self._proxy_client = None

    def exec_command(self, cmd: str, timeout: float = SSH_COMMAND_TIMEOUT) -> tuple[str, str]:
        """
        执行命令，返回 (stdout, stderr)。
        连接断开时尝试一次重连（如启用）。
        """
        if not self.connected:
            if self.auto_reconnect:
                self.connect()
            if not self.connected:
                raise RuntimeError(f"machine {self.machine_id} 未连接")

        with self._lock:
            # 仅锁住 exec_command 的 channel 获取阶段；paramiko Channel 是独立对象，
            # 后续 I/O 读取无需持锁，可与其他命令并发执行
            stdin, stdout, stderr = self._client.exec_command(cmd, timeout=timeout)
        # 锁已释放：stdout/stderr 的阻塞读取不再阻止其他调用者
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        return out, err


class SSHManager:
    """全局 SSH 连接池（单例）"""

    def __init__(self):
        self._connections: dict[int, SSHConnection] = {}
        self._lock = threading.Lock()

    def add(self, machine_id: int, host: str, port: int, username: str,
            password: Optional[str] = None, private_key: Optional[str] = None,
            proxy_host: Optional[str] = None, proxy_port: int = 22,
            proxy_username: Optional[str] = None,
            proxy_password: Optional[str] = None,
            proxy_private_key: Optional[str] = None,
            auto_reconnect: bool = True) -> SSHConnection:
        with self._lock:
            conn = SSHConnection(
                machine_id, host, port, username,
                password, private_key,
                proxy_host=proxy_host, proxy_port=proxy_port,
                proxy_username=proxy_username,
                proxy_password=proxy_password,
                proxy_private_key=proxy_private_key,
                auto_reconnect=auto_reconnect,
            )
            self._connections[machine_id] = conn
        return conn

    def get(self, machine_id: int) -> Optional[SSHConnection]:
        return self._connections.get(machine_id)

    def remove(self, machine_id: int) -> None:
        with self._lock:
            conn = self._connections.pop(machine_id, None)
            if conn:
                conn.disconnect()

    def connect(self, machine_id: int) -> bool:
        conn = self.get(machine_id)
        if conn is None:
            return False
        return conn.connect()

    def disconnect(self, machine_id: int) -> None:
        conn = self.get(machine_id)
        if conn:
            conn.disconnect()

    def is_connected(self, machine_id: int) -> bool:
        conn = self.get(machine_id)
        return conn is not None and conn.connected

    def exec_command(self, machine_id: int, cmd: str) -> tuple[str, str]:
        conn = self.get(machine_id)
        if conn is None:
            raise RuntimeError(f"找不到 machine_id={machine_id} 的连接")
        return conn.exec_command(cmd)

    def all_statuses(self) -> dict[int, bool]:
        return {mid: conn.connected for mid, conn in self._connections.items()}


# 全局单例
ssh_manager = SSHManager()
