"""Creator authentication object and complete parameter ownership boundary."""

from __future__ import annotations

from dataclasses import InitVar, dataclass, field
from typing import Any, ClassVar, Mapping, Optional

from xhs_utils.xhs_core.auth import CREATOR_PLATFORM_CONFIG, XHSAuth, XHSPlatformConfig
from xhs_utils.xhs_core.cookies import HostCookieStore

from .state import (
    DS_REFRESH_INTERVAL_MS,
    CreatorB1RuntimeState,
    CreatorDeviceProfile,
    cookie_header,
    now_ms,
    parse_cookie_kv,
)
from .http import CreatorHttpClient


CREATOR_PARAMETER_SOURCES = {
    'local_algorithm': (
        'a1', 'webId', 'ets', 'loadts', 'b1',
        'MNS0101', 'MNS0201', 'X-s', 'X-t', 'X-S-Common',
        'x-b3-traceid', 'x-xray-traceid', 'profileData',
    ),
    'browser_derived_profile_data': (
        'b1_state', 'web_profile_fields', 'MNS envConst/envFpTail',
        'release appId/platform/webBuild/signVersion',
        'optional post-login abRequestId',
    ),
    'managed_lifecycle_state': (
        'dsllt', 'MNS seq', 'b1b1', 'sc', 'security_ready',
    ),
    'remote_program_or_anchor': (
        '_dsl', '_dsf DS program', 'scripting program', 'websectiga',
    ),
    'server_issued': (
        'gid', 'sec_poison_id', 'host-scoped acw_tc', 'customer-sso-sid',
        'access-token-creator.xiaohongshu.com', 'galaxy_creator_session_id',
        'web_session', 'id_token', 'QR id/url', 'service ticket',
    ),
    'user_interaction': (
        'complete_cookie_for_cookie_login', 'QR scan and confirmation',
        'phone number', 'SMS code',
    ),
}

_AUTH_FACTORY_TOKEN = object()
_AUTH_COOKIE_KEYS = (
    'customer-sso-sid',
    'access-token-creator.xiaohongshu.com',
    'galaxy_creator_session_id',
    'web_session',
)


@dataclass
class XHSCreatorAuth(XHSAuth):
    """Creator Center authentication plus all mutable signing inputs.

    This class can only be created through three factories::

        auth = XHSCreatorAuth.from_cookie(complete_cookie)
        auth = XHSCreatorAuth.from_qrcode_login()
        auth = XHSCreatorAuth.from_phone_login()

    User input is limited to the selected authentication source and optional
    reverse-alignment overrides.  Normal QR/phone use locally generates b1,
    MNS, X-s, X-S-Common and profileData; the browser is never started.
    Creator HTTP requests reuse one curl_cffi Chrome-impersonating Session;
    this changes only TLS/HTTP2 transport and does not connect to Chrome.

    Parameters that cannot be forged are still issued by XHS: login/session
    Cookies, QR identifiers, SMS/service tickets, ``gid`` and
    ``sec_poison_id``.  ``websectiga`` is produced by executing the explicit
    server-issued scripting program in a minimal local JS host, not by opening
    a browser.

    ``b1`` and the MNS environment are evidence-backed browser profiles rather
    than arbitrary random strings. Creator ``mns0101`` additionally executes
    the server-issued DS ``_dsf`` program inside a restricted local Node VM;
    the user never supplies it. Pass ``b1_state`` or ``mns_env`` only when
    replaying a newly captured browser fixture byte-for-byte.
    """

    PLATFORM_CONFIG: ClassVar[XHSPlatformConfig] = CREATOR_PLATFORM_CONFIG

    platform: str = 'creator'
    login_source: str = 'cookie'
    cookies: Any = field(default='', repr=False)
    b1: str = field(default='', repr=False)
    dsl: str = field(default='', repr=False)
    local_storage: Mapping[str, Any] = field(default_factory=dict, repr=False)
    session_storage: Mapping[str, Any] = field(default_factory=dict, repr=False)
    b1_state: Optional[CreatorB1RuntimeState] = field(default=None, repr=False)
    mns_env: Mapping[str, Mapping[str, Any]] = field(default_factory=dict, repr=False)
    web_profile_fields: Mapping[str, Any] = field(default_factory=dict, repr=False)
    host_cookies: Mapping[str, Any] = field(default_factory=dict, repr=False)
    host_cookie_state: Mapping[str, Any] = field(default_factory=dict, repr=False)
    cookie_source_url: str = field(default='', repr=False)
    profile: Optional[CreatorDeviceProfile] = field(default=None, repr=False)
    http_client: Optional[CreatorHttpClient] = field(default=None, repr=False)
    _cookie_store: HostCookieStore = field(init=False, repr=False)
    _factory_token: InitVar[object] = None

    def __post_init__(self, _factory_token: object) -> None:
        if _factory_token is not _AUTH_FACTORY_TOKEN:
            raise TypeError(
                'XHSCreatorAuth cannot be constructed directly; use '
                'from_cookie(), from_qrcode_login(), or from_phone_login()'
            )
        self.login_source = self._bind_platform(self.login_source)
        if self.http_client is None:
            self.http_client = CreatorHttpClient(proxies=self.proxies)
        values = parse_cookie_kv(self.cookies)
        self._cookie_store = (
            HostCookieStore.from_state(self.host_cookie_state)
            if self.host_cookie_state
            else HostCookieStore(self.host_cookies)
        )
        self._cookie_store.extract_host_only(
            values,
            self.cookie_source_url or self.origin('api'),
        )
        self.host_cookies = self._cookie_store.snapshot()
        self.cookies = cookie_header(values)

        if self.profile is None:
            self.profile = CreatorDeviceProfile(
                cookies=values,
                local_storage=self.local_storage,
                session_storage=self.session_storage,
                fixed_b1=self.b1,
                dsl=self.dsl,
                b1_state=self.b1_state,
                web_profile_fields=dict(self.web_profile_fields or {}),
                source=f'auth:{self.login_source}',
            )
        else:
            self.profile.update_cookies(values)
            if self.b1:
                self.profile.fixed_b1 = str(self.b1)
            if self.b1_state is not None:
                self.profile.b1_state = self.b1_state
            if self.web_profile_fields:
                self.profile.web_profile_fields.update(
                    {str(key): value for key, value in self.web_profile_fields.items()}
                )

        for stage, material in dict(self.mns_env or {}).items():
            self.profile.set_mns_stage(
                str(stage),
                env_const=int(material['envConst']),
                env_fp_tail=material.get('envFpTailHex', material.get('envFpTail')),
                device_tag=material.get('deviceTag'),
                evidence=str(material.get('evidence') or 'XHSCreatorAuth override'),
            )
        self._set_dsl(self.dsl or self.profile.dsl)
        self.validate(require_authenticated=True)

    @staticmethod
    def parameter_sources() -> dict:
        return {
            name: tuple(values)
            for name, values in CREATOR_PARAMETER_SOURCES.items()
        }

    @property
    def cookie_map(self) -> dict:
        return self.profile.cookie_map

    @property
    def sign_cookie(self) -> str:
        return self.profile.document_cookie

    def cookies_for_url(self, url: str, cookies: Any = None) -> dict:
        return self._cookie_store.cookies_for_url(
            url,
            self.profile.cookie_map if cookies is None else cookies,
        )

    def host_cookies_snapshot(self) -> dict:
        return self._cookie_store.snapshot()

    @property
    def a1(self) -> str:
        return self.profile.cookie_map['a1']

    def validate(self, require_authenticated: bool = True) -> None:
        cookies = self.profile.cookie_map
        if not cookies.get('a1'):
            raise ValueError('Creator Cookie must contain a1')
        if require_authenticated and not any(cookies.get(key) for key in _AUTH_COOKIE_KEYS):
            raise ValueError(
                'Creator Cookie is not authenticated; pass the complete Cookie '
                'or use QR/phone login'
            )

    def current_b1(
        self,
        timestamp_ms: Optional[int] = None,
        profile_name: Optional[str] = None,
    ) -> str:
        return self.profile.current_b1(timestamp_ms, profile_name=profile_name)

    def next_sign_context(
        self,
        api: str,
        *,
        tier: Optional[str] = None,
        mns_profile: Optional[str] = None,
        timestamp_ms: Optional[int] = None,
        version: Optional[int] = None,
    ) -> dict:
        del api
        return self.profile.next_sign_context(
            tier=tier,
            mns_profile=mns_profile,
            timestamp_ms=timestamp_ms,
            version=version,
        )

    def dsl_pair(self, timestamp_ms: Optional[int] = None) -> str:
        self.ensure_ds_material()
        return self.profile.dsl_pair(timestamp_ms)

    def ensure_ds_material(self, force: bool = False) -> None:
        """Ensure both ``_dsl`` and the matching server-issued ``_dsf`` program.

        Creator ``mns0101`` calls ``_dsf(null, 24-byte input)`` from the DS
        program.  The program is fetched and executed locally in a restricted
        Node VM; no browser is opened or connected.
        """
        if not self.profile.session.security_ready:
            return
        stale = (
            now_ms() - int(self.profile.session.dsllt)
            >= DS_REFRESH_INTERVAL_MS
        )
        if not force and not stale and self.profile.dsl and self.profile.ds_program:
            return
        force = bool(force or stale)
        from .dsl import get_ds_bundle

        dsl, program = get_ds_bundle(
            proxies=self.proxies,
            force=force,
            http_client=self.http_client,
        )
        if force or not self.profile.dsl:
            self.profile.dsl = dsl
        self.profile.ds_program = program
        if force:
            self.profile.session.dsllt = now_ms()

    def refresh_dsl(self) -> str:
        self.ensure_ds_material(force=True)
        return self.profile.dsl_pair()

    def update_cookies(self, cookies: Any, *, source_url: str = '') -> None:
        values = self.profile.cookie_map
        updates = parse_cookie_kv(cookies)
        self._cookie_store.extract_host_only(
            updates,
            source_url or self.origin('api'),
        )
        values.update(updates)
        self.profile.update_cookies(values)
        self.cookies = cookie_header(self.profile.cookie_map)
        self.host_cookies = self._cookie_store.snapshot()

    def update_runtime_state(
        self,
        *,
        b1: Optional[str] = None,
        dsl: Optional[str] = None,
        b1_state: Optional[CreatorB1RuntimeState] = None,
        web_profile_fields: Optional[Mapping[str, Any]] = None,
    ) -> 'XHSCreatorAuth':
        if b1 is not None:
            self.b1 = str(b1)
            self.profile.fixed_b1 = self.b1
        if dsl is not None:
            self._set_dsl(dsl)
        if b1_state is not None:
            self.b1_state = b1_state
            self.profile.b1_state = b1_state
        if web_profile_fields is not None:
            self.web_profile_fields = dict(web_profile_fields)
            self.profile.web_profile_fields.update(self.web_profile_fields)
        return self

    def state_snapshot(self) -> dict:
        state = self.profile.state_snapshot()
        state['loginSource'] = self.login_source
        state['transport'] = self.http_client.state_snapshot()
        state['hostCookieKeys'] = {
            host: list(values)
            for host, values in self._cookie_store.snapshot().items()
        }
        return state

    def close(self) -> None:
        self.http_client.close()

    @classmethod
    def from_cookie(cls, cookies: Any, **auth_kwargs) -> 'XHSCreatorAuth':
        """Create from a complete user-supplied authenticated Creator Cookie."""
        auth_kwargs['login_source'] = 'cookie'
        return cls(
            cookies=cookies,
            _factory_token=_AUTH_FACTORY_TOKEN,
            **auth_kwargs,
        )

    @classmethod
    def from_qrcode_login(
        cls,
        *,
        show_in_terminal: bool = True,
        **auth_kwargs,
    ) -> 'XHSCreatorAuth':
        """Run the pure-HTTP Creator QR flow and return ready Auth."""
        from apis.xhs_creator_login_apis import XHSCreatorLoginApi

        profile = cls._new_login_profile(auth_kwargs, source='auth:qrcode')
        http_client = auth_kwargs.get('http_client') or CreatorHttpClient(
            proxies=auth_kwargs.get('proxies')
        )
        login = XHSCreatorLoginApi(
            profile=profile,
            proxies=auth_kwargs.get('proxies'),
            http_client=http_client,
        )
        cookies = login.qrcode_login(show_in_terminal=show_in_terminal)
        if not cookies:
            login.close()
            raise RuntimeError('Creator QR login did not return an authenticated Cookie')
        auth_kwargs['login_source'] = 'qrcode'
        # 登录期间的会话级重试可能已重建传输实例，使用最终获胜会话的 client
        auth_kwargs['http_client'] = login.http
        auth_kwargs['host_cookies'] = login.host_cookies_snapshot()
        auth_kwargs['host_cookie_state'] = login.host_cookie_state()
        auth_kwargs['cookie_source_url'] = CREATOR_PLATFORM_CONFIG.origin('api')
        return cls(
            cookies=cookies,
            profile=profile,
            _factory_token=_AUTH_FACTORY_TOKEN,
            **auth_kwargs,
        )

    @classmethod
    def from_phone_login(cls, **auth_kwargs) -> 'XHSCreatorAuth':
        """Run the pure-HTTP Creator SMS flow and return ready Auth."""
        from apis.xhs_creator_login_apis import XHSCreatorLoginApi

        profile = cls._new_login_profile(auth_kwargs, source='auth:phone')
        http_client = auth_kwargs.get('http_client') or CreatorHttpClient(
            proxies=auth_kwargs.get('proxies')
        )
        login = XHSCreatorLoginApi(
            profile=profile,
            proxies=auth_kwargs.get('proxies'),
            http_client=http_client,
        )
        cookies = login.phone_login()
        if not cookies:
            login.close()
            raise RuntimeError('Creator phone login did not return an authenticated Cookie')
        auth_kwargs['login_source'] = 'phone'
        # 登录期间的会话级重试可能已重建传输实例，使用最终获胜会话的 client
        auth_kwargs['http_client'] = login.http
        auth_kwargs['host_cookies'] = login.host_cookies_snapshot()
        auth_kwargs['host_cookie_state'] = login.host_cookie_state()
        auth_kwargs['cookie_source_url'] = CREATOR_PLATFORM_CONFIG.origin('api')
        return cls(
            cookies=cookies,
            profile=profile,
            _factory_token=_AUTH_FACTORY_TOKEN,
            **auth_kwargs,
        )

    @staticmethod
    def _new_login_profile(
        auth_kwargs: Mapping[str, Any],
        *,
        source: str,
    ) -> CreatorDeviceProfile:
        profile = CreatorDeviceProfile(
            cookies='',
            local_storage=auth_kwargs.get('local_storage') or {},
            session_storage=auth_kwargs.get('session_storage') or {},
            fixed_b1=str(auth_kwargs.get('b1') or ''),
            dsl=str(auth_kwargs.get('dsl') or ''),
            b1_state=auth_kwargs.get('b1_state'),
            web_profile_fields=dict(auth_kwargs.get('web_profile_fields') or {}),
            source=source,
        )
        for stage, material in dict(auth_kwargs.get('mns_env') or {}).items():
            profile.set_mns_stage(
                str(stage),
                env_const=int(material['envConst']),
                env_fp_tail=material.get('envFpTailHex', material.get('envFpTail')),
                device_tag=material.get('deviceTag'),
                evidence=str(material.get('evidence') or source),
            )
        return profile

    def _set_dsl(self, value: str) -> None:
        text = str(value or '')
        if ';' in text:
            dsllt, text = text.split(';', 1)
            if dsllt.isdigit():
                self.profile.session.dsllt = int(dsllt)
        self.dsl = text
        self.profile.dsl = text
        if text and text != 'undefined':
            self.profile.session.security_ready = True


__all__ = ['CREATOR_PARAMETER_SOURCES', 'XHSCreatorAuth']
