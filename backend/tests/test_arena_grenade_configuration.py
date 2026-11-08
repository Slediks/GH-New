import math

from backend.app.arena import grenade_settings, grenades
from backend.tests.conftest import sign_in
from shared.models import User


def test_admin_grenade_config_validation_version_and_reset(client, database):
    user, headers = sign_in(client, "grenade-admin")
    endpoint = "/api/arena/admin/grenades"
    assert client.get(endpoint, headers=headers).status_code == 403
    with database.begin() as db:
        db.get(User, user["id"]).role = "admin"
    initial = client.get(endpoint, headers=headers).json
    config = initial["config"]
    config["frag"]["count"] = 3
    config["frag"]["max_damage"] = 144
    config["smoke"]["radius"] = 7.5
    config["flash"]["enabled"] = False
    config["molotov"]["patch_count"] = 9
    saved = client.post(endpoint, json={"version": initial["version"], "config": config},
                        headers=headers)
    assert saved.status_code == 200, saved.json
    assert client.get(endpoint, headers=headers).json["config"] == config
    assert grenades.inventory(config)["flash"] == 0
    assert client.post(endpoint, json={"version": initial["version"], "config": config},
                       headers=headers).status_code == 409
    invalid = grenade_settings.defaults()
    invalid["molotov"]["patch_count"] = 1000000
    assert client.post(endpoint, json={"version": saved.json["version"], "config": invalid},
                       headers=headers).status_code == 400
    invalid = grenade_settings.defaults()
    invalid["frag"]["radius"] = -1
    assert client.post(endpoint, json={"version": saved.json["version"], "config": invalid},
                       headers=headers).status_code == 400
    invalid = grenade_settings.defaults()
    invalid["smoke"]["radius"] = math.nan
    try:
        grenade_settings.validate(invalid)
        assert False, "NaN must be rejected"
    except Exception as error:
        assert "smoke.radius" in str(error)
    reset = client.post(endpoint + "/reset", json={"version": saved.json["version"]},
                        headers=headers)
    assert reset.status_code == 200, reset.json
    assert reset.json["config"] == grenade_settings.defaults()
