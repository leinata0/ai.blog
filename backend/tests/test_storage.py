from app import storage as storage_mod


def test_build_generated_name_uses_content_type_extension_when_missing():
    generated = storage_mod._build_generated_name("image", "image/png")
    assert generated.endswith(".png")


def test_list_uploaded_images_keeps_extensionless_files(upload_dir):
    file_path = upload_dir / "image-without-extension"
    file_path.write_bytes(b"image-bytes")

    images = storage_mod.list_uploaded_images()

    assert any(image["filename"] == "image-without-extension" for image in images)
