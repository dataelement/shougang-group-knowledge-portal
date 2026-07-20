from pathlib import Path


def _api_location() -> str:
    config = (Path(__file__).parents[2] / "deploy/nginx/default.conf.template").read_text()
    start = config.index("location /api/")
    end = config.index("\n    }", start)
    return config[start:end]


def test_course_upload_proxy_supports_one_gib_plus_multipart_overhead():
    location = _api_location()

    assert "client_max_body_size 1100m;" in location
    assert "proxy_request_buffering off;" in location
    assert "proxy_send_timeout 600s;" in location
    assert "proxy_read_timeout 600s;" in location
